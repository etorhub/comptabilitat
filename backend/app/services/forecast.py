"""Projeccio del saldo i deteccio anticipada de descoberts.

La projeccio suma al saldo actual els rebuts recurrents previstos i una deriva
de despesa no recurrent estimada a partir dels ultims mesos. Es dona en tres
linies (esperada, optimista i pessimista) perque la despesa variable no es
previsible amb una sola xifra.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.time import today_local
from app.models import Ledger, RecurringOccurrence, RecurringSeries, Transaction
from app.models.enums import (
    AlertSeverity,
    AlertType,
    SeriesStatus,
    TransactionStatus,
)
from app.services.alerts import create_alert
from app.services.balances import ledger_balance

logger = logging.getLogger(__name__)

# Historic que es mira per estimar la despesa variable.
DISCRETIONARY_WINDOW_DAYS = 90
# Els imports mes grans es descarten: una compra excepcional no es una tendencia.
OUTLIER_TRIM_RATIO = 0.05
# Amplada de la banda optimista i pessimista sobre la despesa variable.
BAND_SPREAD = Decimal("0.30")


@dataclass
class ForecastEvent:
    day: date
    label: str
    amount: Decimal
    series_id: int | None = None


@dataclass
class ForecastPoint:
    day: date
    expected: Decimal
    optimistic: Decimal
    pessimistic: Decimal


@dataclass
class Forecast:
    ledger_id: int
    ledger_name: str
    currency: str
    starting_balance: Decimal
    threshold: Decimal
    horizon_days: int
    daily_discretionary: Decimal
    points: list[ForecastPoint] = field(default_factory=list)
    events: list[ForecastEvent] = field(default_factory=list)
    first_breach_day: date | None = None
    first_breach_amount: Decimal | None = None


def daily_discretionary_spend(db: Session, ledger_id: int) -> Decimal:
    """Despesa diaria mitjana que no ve de cap rebut recurrent.

    Es descarten els imports mes alts perque una compra excepcional no marqui
    la tendencia de tot el trimestre.
    """
    since = today_local() - timedelta(days=DISCRETIONARY_WINDOW_DAYS)
    recurring_ids = set(
        db.scalars(
            select(RecurringOccurrence.transaction_id)
            .join(RecurringSeries, RecurringSeries.id == RecurringOccurrence.series_id)
            .where(RecurringSeries.ledger_id == ledger_id)
        )
    )

    amounts = [
        -transaction.amount
        for transaction in db.scalars(
            select(Transaction).where(
                Transaction.ledger_id == ledger_id,
                Transaction.booking_date >= since,
                Transaction.amount < 0,
                Transaction.status == TransactionStatus.BOOKED,
                Transaction.transfer_group_id.is_(None),
                Transaction.is_excluded.is_(False),
            )
        )
        if transaction.id not in recurring_ids
    ]
    if not amounts:
        return Decimal("0.00")

    amounts.sort()
    trim = int(len(amounts) * OUTLIER_TRIM_RATIO)
    if trim:
        amounts = amounts[:-trim]
    total = sum(amounts, Decimal("0.00"))
    return (total / Decimal(DISCRETIONARY_WINDOW_DAYS)).quantize(Decimal("0.01"))


def upcoming_events(
    db: Session, ledger_id: int, horizon: date, start: date | None = None
) -> list[ForecastEvent]:
    """Rebuts recurrents previstos d'aqui a l'horitzo."""
    start = start or today_local()
    events: list[ForecastEvent] = []

    for series in db.scalars(
        select(RecurringSeries).where(
            RecurringSeries.ledger_id == ledger_id,
            RecurringSeries.status == SeriesStatus.ACTIVE,
            RecurringSeries.include_in_forecast.is_(True),
        )
    ):
        interval = max(series.interval_days, 1)
        occurrence = series.next_expected_date or (series.last_seen_date + timedelta(interval))
        # Si la data prevista ja ha passat, s'avanca fins a la primera futura.
        while occurrence < start:
            occurrence += timedelta(days=interval)
        while occurrence <= horizon:
            events.append(
                ForecastEvent(
                    day=occurrence,
                    label=series.label,
                    amount=series.expected_amount,
                    series_id=series.id,
                )
            )
            occurrence += timedelta(days=interval)

    events.sort(key=lambda item: item.day)
    return events


def build_forecast(db: Session, ledger: Ledger, horizon_days: int | None = None) -> Forecast:
    horizon_days = horizon_days or settings.forecast_horizon_days
    start = today_local()
    horizon = start + timedelta(days=horizon_days)

    balance, _ = ledger_balance(db, ledger.id)
    daily = daily_discretionary_spend(db, ledger.id)
    events = upcoming_events(db, ledger.id, horizon, start)

    forecast = Forecast(
        ledger_id=ledger.id,
        ledger_name=ledger.name,
        currency=ledger.currency,
        starting_balance=balance,
        threshold=ledger.overdraft_threshold,
        horizon_days=horizon_days,
        daily_discretionary=daily,
        events=events,
    )

    events_by_day: dict[date, Decimal] = {}
    for event in events:
        events_by_day[event.day] = events_by_day.get(event.day, Decimal("0.00")) + event.amount

    running = balance
    optimistic_drift = daily * (Decimal("1") - BAND_SPREAD)
    pessimistic_drift = daily * (Decimal("1") + BAND_SPREAD)

    for offset in range(horizon_days + 1):
        day = start + timedelta(days=offset)
        running += events_by_day.get(day, Decimal("0.00"))
        expected = (running - daily * offset).quantize(Decimal("0.01"))
        point = ForecastPoint(
            day=day,
            expected=expected,
            optimistic=(running - optimistic_drift * offset).quantize(Decimal("0.01")),
            pessimistic=(running - pessimistic_drift * offset).quantize(Decimal("0.01")),
        )
        forecast.points.append(point)

        if forecast.first_breach_day is None and expected < ledger.overdraft_threshold:
            forecast.first_breach_day = day
            forecast.first_breach_amount = expected

    return forecast


def check_overdrafts(db: Session, horizon_days: int | None = None) -> int:
    """Genera un avis per cada llibre que es preveu que entri en descobert."""
    created = 0
    for ledger in db.scalars(select(Ledger).where(Ledger.is_active.is_(True))):
        forecast = build_forecast(db, ledger, horizon_days)
        if forecast.first_breach_day is None:
            continue

        days_ahead = (forecast.first_breach_day - today_local()).days
        cause = next(
            (
                event
                for event in forecast.events
                if event.day <= forecast.first_breach_day and event.amount < 0
            ),
            None,
        )
        body = (
            f"Amb el saldo actual de {forecast.starting_balance:.2f} EUR, els rebuts "
            f"previstos i una despesa variable de {forecast.daily_discretionary:.2f} EUR al "
            f"dia, el saldo baixaria a {forecast.first_breach_amount:.2f} EUR el "
            f"{forecast.first_breach_day:%d/%m/%Y}."
        )
        if cause is not None:
            body += f" El primer rebut important previst es {cause.label}."

        alert = create_alert(
            db,
            type=AlertType.PROJECTED_OVERDRAFT,
            ledger_id=ledger.id,
            # Una alerta per llibre i setmana: el mateix descobert no ha d'avisar cada dia.
            dedup_key=f"overdraft:{ledger.id}:{forecast.first_breach_day.isocalendar()[:2]}",
            title=f"{ledger.name}: possible descobert d'aqui a {days_ahead} dies",
            body=body,
            severity=AlertSeverity.CRITICAL if days_ahead <= 14 else AlertSeverity.WARNING,
            payload={
                "ledger_id": ledger.id,
                "breach_day": forecast.first_breach_day.isoformat(),
                "breach_amount": str(forecast.first_breach_amount),
                "starting_balance": str(forecast.starting_balance),
            },
        )
        if alert is not None:
            created += 1
    db.flush()
    return created
