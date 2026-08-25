"""Panells, informes i previsions."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.core.time import today_local, utcnow
from app.deps import CurrentUser, DbSession, get_ledger_or_403, resolve_ledger_scope
from app.models import Account, Alert, Ledger
from app.models.enums import AlertStatus
from app.schemas.analytics import (
    BalanceSeriesPoint,
    CategoryBreakdownItem,
    DashboardOut,
    ForecastEvent,
    ForecastOut,
    ForecastPoint,
    LedgerSummary,
    MerchantBreakdownItem,
    MonthlyPoint,
)
from app.services import reports
from app.services.balances import balance_series, ledger_balance
from app.services.forecast import build_forecast

router = APIRouter(prefix="/analytics", tags=["analisi"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DbSession, user: CurrentUser, ledger_ids: list[int] | None = Query(default=None)):
    """Resum per llibre mes el consolidat."""
    scope = resolve_ledger_scope(db, user, ledger_ids)
    month_start, next_month = reports.month_bounds()
    month_end = next_month - timedelta(days=1)

    summaries: list[LedgerSummary] = []
    total = Decimal("0.00")

    for ledger in db.scalars(
        select(Ledger).where(Ledger.id.in_(scope)).order_by(Ledger.position, Ledger.name)
    ):
        balance, balance_date = ledger_balance(db, ledger.id)
        income, expenses = reports.income_and_expenses(db, [ledger.id], month_start, month_end)
        accounts = int(
            db.scalar(
                select(func.count(Account.id)).where(
                    Account.ledger_id == ledger.id, Account.is_active.is_(True)
                )
            )
            or 0
        )
        summaries.append(
            LedgerSummary(
                ledger_id=ledger.id,
                ledger_name=ledger.name,
                ledger_color=ledger.color,
                currency=ledger.currency,
                current_balance=balance,
                balance_date=balance_date,
                income_this_month=income,
                expenses_this_month=expenses,
                net_this_month=income - expenses,
                accounts=accounts,
                uncategorized=reports.count_uncategorized(db, [ledger.id]),
            )
        )
        total += balance

    active_alerts = int(
        db.scalar(select(func.count(Alert.id)).where(Alert.status == AlertStatus.NEW)) or 0
    )
    return DashboardOut(
        generated_at=utcnow(),
        total_balance=total,
        ledgers=summaries,
        active_alerts=active_alerts,
        pending_review=reports.count_pending_review(db, scope),
    )


@router.get("/monthly", response_model=list[MonthlyPoint])
def monthly(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    months: int = Query(default=12, ge=1, le=60),
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    date_to = today_local()
    date_from = (date_to.replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1)
    rows = reports.monthly_series(db, scope, date_from, date_to)
    return [MonthlyPoint(**row) for row in rows]


@router.get("/categories", response_model=list[CategoryBreakdownItem])
def categories_breakdown(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    date_from: date | None = None,
    date_to: date | None = None,
    expenses: bool = True,
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    rows = reports.category_breakdown(db, scope, date_from, date_to, expenses=expenses)
    return [CategoryBreakdownItem(**row) for row in rows]


@router.get("/merchants", response_model=list[MerchantBreakdownItem])
def merchants_breakdown(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=20, ge=1, le=100),
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    rows = reports.merchant_breakdown(db, scope, date_from, date_to, limit=limit)
    return [MerchantBreakdownItem(**row) for row in rows]


@router.get("/balance-series", response_model=list[BalanceSeriesPoint])
def balances(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    days: int = Query(default=180, ge=7, le=1095),
):
    """Evolucio del saldo reconstruida cap enrere des del saldo actual."""
    scope = resolve_ledger_scope(db, user, ledger_ids)
    date_to = today_local()
    date_from = date_to - timedelta(days=days)
    series = balance_series(db, scope, date_from, date_to)
    return [BalanceSeriesPoint(day=day, balance=amount) for day, amount in series]


@router.get("/forecast/{ledger_id}", response_model=ForecastOut)
def forecast(
    ledger_id: int,
    db: DbSession,
    user: CurrentUser,
    horizon_days: int = Query(default=90, ge=7, le=365),
):
    ledger = get_ledger_or_403(db, user, ledger_id)
    result = build_forecast(db, ledger, horizon_days)
    return ForecastOut(
        ledger_id=result.ledger_id,
        ledger_name=result.ledger_name,
        currency=result.currency,
        starting_balance=result.starting_balance,
        horizon_days=result.horizon_days,
        threshold=result.threshold,
        daily_discretionary=result.daily_discretionary,
        points=[
            ForecastPoint(
                day=point.day,
                expected=point.expected,
                optimistic=point.optimistic,
                pessimistic=point.pessimistic,
            )
            for point in result.points
        ],
        events=[
            ForecastEvent(
                day=event.day,
                label=event.label,
                amount=event.amount,
                series_id=event.series_id,
            )
            for event in result.events
        ],
        first_breach_day=result.first_breach_day,
        first_breach_amount=result.first_breach_amount,
    )
