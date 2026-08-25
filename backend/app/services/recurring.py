"""Deteccio de moviments recurrents i subscripcions.

Un rebut es reconeix perque el mateix emissor apareix a intervals regulars amb
un import estable. A partir d'aqui es pot avisar quan puja de preu o quan un
mes no arriba, i sobretot es pot projectar el saldo dels propers mesos.
"""

from __future__ import annotations

import logging
import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_local
from app.models import Ledger, RecurringOccurrence, RecurringSeries, Transaction
from app.models.enums import (
    AlertSeverity,
    AlertType,
    Cadence,
    SeriesStatus,
    TransactionStatus,
)
from app.services.alerts import create_alert

logger = logging.getLogger(__name__)

# Falta de calendari: no tots els mesos tenen els mateixos dies.
CADENCE_TOLERANCE_DAYS = {
    Cadence.WEEKLY: 2,
    Cadence.BIWEEKLY: 3,
    Cadence.MONTHLY: 6,
    Cadence.BIMONTHLY: 8,
    Cadence.QUARTERLY: 12,
    Cadence.SEMIANNUAL: 20,
    Cadence.ANNUAL: 30,
}
MIN_OCCURRENCES = 3
# Un rebut es dona per perdut quan passen aquests dies de la data prevista.
MISSING_GRACE_DAYS = 7
HISTORY_MONTHS = 18


@dataclass
class RecurringStats:
    created: int = 0
    updated: int = 0
    ended: int = 0
    alerts: int = 0

    def __str__(self) -> str:
        return (
            f"recurrents: {self.created} noves, {self.updated} actualitzades, "
            f"{self.ended} finalitzades, {self.alerts} avisos"
        )


def _signature(transaction: Transaction) -> str | None:
    """Clau que identifica la serie: el comerc mes el sentit de l'import."""
    base = (
        transaction.merchant.normalized_name
        if transaction.merchant
        else transaction.normalized_description
    )
    if not base:
        return None
    direction = "in" if transaction.amount > 0 else "out"
    return f"{base}|{direction}"[:220]


def _closest_cadence(interval_days: float) -> Cadence | None:
    for cadence in Cadence:
        if abs(interval_days - cadence.days) <= CADENCE_TOLERANCE_DAYS[cadence]:
            return cadence
    return None


def _regularity(intervals: list[int], expected: float, tolerance: int) -> float:
    """Proporcio d'intervals que encaixen amb la cadencia trobada."""
    if not intervals:
        return 0.0
    good = sum(1 for value in intervals if abs(value - expected) <= tolerance)
    return good / len(intervals)


def detect_recurring(db: Session, ledger_id: int | None = None) -> RecurringStats:
    """Recalcula les series recurrents a partir de l'historic."""
    stats = RecurringStats()
    since = today_local() - timedelta(days=HISTORY_MONTHS * 31)

    ledgers = (
        [db.get(Ledger, ledger_id)]
        if ledger_id
        else list(db.scalars(select(Ledger).where(Ledger.is_active.is_(True))))
    )
    for ledger in [item for item in ledgers if item is not None]:
        groups: dict[str, list[Transaction]] = {}
        for transaction in db.scalars(
            select(Transaction)
            .where(
                Transaction.ledger_id == ledger.id,
                Transaction.booking_date >= since,
                Transaction.status == TransactionStatus.BOOKED,
                Transaction.transfer_group_id.is_(None),
                Transaction.is_excluded.is_(False),
            )
            .order_by(Transaction.booking_date)
        ):
            signature = _signature(transaction)
            if signature:
                groups.setdefault(signature, []).append(transaction)

        for signature, items in groups.items():
            _evaluate_group(db, ledger, signature, items, stats)

    db.flush()
    return stats


def _evaluate_group(
    db: Session,
    ledger: Ledger,
    signature: str,
    items: list[Transaction],
    stats: RecurringStats,
) -> None:
    existing = db.scalar(
        select(RecurringSeries).where(
            RecurringSeries.ledger_id == ledger.id, RecurringSeries.signature == signature
        )
    )

    if len(items) < MIN_OCCURRENCES:
        return

    dates = [item.booking_date for item in items]
    intervals = [(later - earlier).days for earlier, later in zip(dates, dates[1:], strict=False)]
    intervals = [value for value in intervals if value > 0]
    if not intervals:
        return

    median_interval = statistics.median(intervals)
    cadence = _closest_cadence(median_interval)
    if cadence is None:
        return

    tolerance = CADENCE_TOLERANCE_DAYS[cadence]
    regularity = _regularity(intervals, cadence.days, tolerance)
    if regularity < 0.6:
        return

    amounts = [item.amount for item in items]
    expected_amount = Decimal(statistics.median(amounts)).quantize(Decimal("0.01"))
    # Tolerancia d'import: un 10%, amb un minim d'un euro per als rebuts petits.
    amount_tolerance = max(abs(expected_amount) * Decimal("0.10"), Decimal("1.00")).quantize(
        Decimal("0.01")
    )
    confidence = round(min(1.0, regularity * min(1.0, len(items) / 6)), 2)
    last_seen = dates[-1]
    next_expected = last_seen + timedelta(days=int(round(median_interval)))
    last = items[-1]

    if existing is None:
        existing = RecurringSeries(
            ledger_id=ledger.id,
            signature=signature,
            label=(last.merchant.display_name if last.merchant else last.normalized_description)
            or last.description[:80],
            merchant_id=last.merchant_id,
            category_id=last.category_id,
            cadence=cadence,
            expected_amount=expected_amount,
            amount_tolerance=amount_tolerance,
            interval_days=int(round(median_interval)),
            confidence=confidence,
            occurrences_count=len(items),
            first_seen_date=dates[0],
            last_seen_date=last_seen,
            next_expected_date=next_expected,
            is_subscription=cadence is Cadence.MONTHLY and last.amount < 0,
        )
        db.add(existing)
        db.flush()
        stats.created += 1
    else:
        previous_amount = existing.expected_amount
        existing.cadence = cadence
        existing.interval_days = int(round(median_interval))
        existing.confidence = confidence
        existing.occurrences_count = len(items)
        existing.last_seen_date = last_seen
        existing.next_expected_date = next_expected
        existing.category_id = last.category_id or existing.category_id
        existing.merchant_id = last.merchant_id or existing.merchant_id
        existing.status = SeriesStatus.ACTIVE
        existing.expected_amount = expected_amount
        existing.amount_tolerance = amount_tolerance
        stats.updated += 1

        if abs(last.amount - previous_amount) > existing.amount_tolerance:
            _alert_amount_change(db, existing, previous_amount, last)
            stats.alerts += 1

    _link_occurrences(db, existing, items)


def _link_occurrences(db: Session, series: RecurringSeries, items: list[Transaction]) -> None:
    known = set(
        db.scalars(
            select(RecurringOccurrence.transaction_id).where(
                RecurringOccurrence.series_id == series.id
            )
        )
    )
    for transaction in items:
        if transaction.id in known:
            continue
        db.add(
            RecurringOccurrence(
                series_id=series.id,
                transaction_id=transaction.id,
                occurred_on=transaction.booking_date,
                amount=transaction.amount,
            )
        )


def _alert_amount_change(
    db: Session, series: RecurringSeries, previous: Decimal, last: Transaction
) -> None:
    direction = "puja" if abs(last.amount) > abs(previous) else "baixa"
    create_alert(
        db,
        type=AlertType.RECURRING_AMOUNT_CHANGE,
        ledger_id=series.ledger_id,
        dedup_key=f"amount-change:{series.id}:{last.booking_date.isoformat()}",
        title=f"{series.label}: l'import {direction} a {abs(last.amount):.2f} EUR",
        body=(
            f"L'import habitual era de {abs(previous):.2f} EUR i l'ultim rebut del "
            f"{last.booking_date:%d/%m/%Y} ha estat de {abs(last.amount):.2f} EUR."
        ),
        severity=AlertSeverity.WARNING,
        payload={
            "series_id": series.id,
            "previous_amount": str(previous),
            "new_amount": str(last.amount),
            "transaction_id": last.id,
        },
    )


def check_missing_occurrences(db: Session) -> int:
    """Avisa dels rebuts que no han arribat quan tocava."""
    today = today_local()
    count = 0
    for series in db.scalars(
        select(RecurringSeries).where(
            RecurringSeries.status == SeriesStatus.ACTIVE,
            RecurringSeries.next_expected_date.is_not(None),
        )
    ):
        expected: date = series.next_expected_date  # type: ignore[assignment]
        overdue_days = (today - expected).days
        if overdue_days < MISSING_GRACE_DAYS:
            continue

        # Passat mes d'un periode sencer, es dona la serie per acabada.
        if overdue_days > series.interval_days + MISSING_GRACE_DAYS:
            series.status = SeriesStatus.ENDED
            continue

        created = create_alert(
            db,
            type=AlertType.RECURRING_MISSING,
            ledger_id=series.ledger_id,
            dedup_key=f"missing:{series.id}:{expected.isoformat()}",
            title=f"{series.label}: no ha arribat el rebut previst",
            body=(
                f"S'esperava el {expected:%d/%m/%Y} un import aproximat de "
                f"{abs(series.expected_amount):.2f} EUR i encara no consta."
            ),
            severity=AlertSeverity.INFO,
            payload={"series_id": series.id, "expected_date": expected.isoformat()},
        )
        if created is not None:
            count += 1
    db.flush()
    return count
