"""Panell, informes i previsio d'un espai."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.core.time import today_local, utcnow
from app.deps import DbSession, Workspace
from app.models import Account, Alert
from app.models.enums import AlertStatus
from app.schemas.analytics import (
    BalanceSeriesPoint,
    CategoryBreakdownItem,
    DashboardOut,
    ForecastEvent,
    ForecastOut,
    ForecastPoint,
    MerchantBreakdownItem,
    MonthlyPoint,
)
from app.services import reports
from app.services.balances import balance_series, ledger_balance
from app.services.forecast import build_forecast

router = APIRouter(prefix="/analytics", tags=["analisi"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DbSession, workspace: Workspace):
    """Resum de l'espai actiu."""
    month_start, next_month = reports.month_bounds()
    month_end = next_month - timedelta(days=1)

    balance, balance_date = ledger_balance(db, workspace.id)
    income, expenses = reports.income_and_expenses(db, [workspace.id], month_start, month_end)
    accounts = int(
        db.scalar(
            select(func.count(Account.id)).where(
                Account.ledger_id == workspace.id, Account.is_active.is_(True)
            )
        )
        or 0
    )
    active_alerts = int(
        db.scalar(
            select(func.count(Alert.id)).where(
                Alert.ledger_id == workspace.id, Alert.status == AlertStatus.NEW
            )
        )
        or 0
    )

    return DashboardOut(
        generated_at=utcnow(),
        ledger_id=workspace.id,
        ledger_code=workspace.code,
        ledger_name=workspace.name,
        ledger_color=workspace.color,
        currency=workspace.currency,
        current_balance=balance,
        balance_date=balance_date,
        income_this_month=income,
        expenses_this_month=expenses,
        net_this_month=income - expenses,
        accounts=accounts,
        uncategorized=reports.count_uncategorized(db, [workspace.id]),
        pending_review=reports.count_pending_review(db, [workspace.id]),
        active_alerts=active_alerts,
    )


@router.get("/monthly", response_model=list[MonthlyPoint])
def monthly(
    db: DbSession,
    workspace: Workspace,
    months: int = Query(default=12, ge=1, le=60),
):
    date_to = today_local()
    date_from = (date_to.replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1)
    rows = reports.monthly_series(db, [workspace.id], date_from, date_to)
    return [MonthlyPoint(**row) for row in rows]


@router.get("/categories", response_model=list[CategoryBreakdownItem])
def categories_breakdown(
    db: DbSession,
    workspace: Workspace,
    date_from: date | None = None,
    date_to: date | None = None,
    expenses: bool = True,
):
    rows = reports.category_breakdown(db, [workspace.id], date_from, date_to, expenses=expenses)
    return [CategoryBreakdownItem(**row) for row in rows]


@router.get("/merchants", response_model=list[MerchantBreakdownItem])
def merchants_breakdown(
    db: DbSession,
    workspace: Workspace,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=20, ge=1, le=100),
):
    rows = reports.merchant_breakdown(db, [workspace.id], date_from, date_to, limit=limit)
    return [MerchantBreakdownItem(**row) for row in rows]


@router.get("/balance-series", response_model=list[BalanceSeriesPoint])
def balances(
    db: DbSession,
    workspace: Workspace,
    days: int = Query(default=180, ge=7, le=1095),
):
    """Evolucio del saldo reconstruida cap enrere des del saldo actual."""
    date_to = today_local()
    date_from = date_to - timedelta(days=days)
    series = balance_series(db, [workspace.id], date_from, date_to)
    return [BalanceSeriesPoint(day=day, balance=amount) for day, amount in series]


@router.get("/forecast", response_model=ForecastOut)
def forecast(
    db: DbSession,
    workspace: Workspace,
    horizon_days: int = Query(default=90, ge=7, le=365),
):
    result = build_forecast(db, workspace, horizon_days)
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
