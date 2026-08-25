"""Esquemes de panells, informes, previsio, recurrents i avisos."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.enums import AlertSeverity, AlertStatus, AlertType, Cadence, SeriesStatus
from app.schemas.common import ORMModel


class LedgerSummary(BaseModel):
    ledger_id: int
    ledger_name: str
    ledger_color: str
    currency: str
    current_balance: Decimal
    balance_date: date | None
    income_this_month: Decimal
    expenses_this_month: Decimal
    net_this_month: Decimal
    accounts: int
    uncategorized: int


class DashboardOut(BaseModel):
    generated_at: datetime
    total_balance: Decimal
    ledgers: list[LedgerSummary]
    active_alerts: int
    pending_review: int


class MonthlyPoint(BaseModel):
    period: str  # AAAA-MM
    income: Decimal
    expenses: Decimal
    net: Decimal


class CategoryBreakdownItem(BaseModel):
    category_id: int | None
    category_name: str
    color: str
    amount: Decimal
    share: float
    transactions: int


class MerchantBreakdownItem(BaseModel):
    merchant_id: int | None
    merchant_name: str
    amount: Decimal
    transactions: int


class BalanceSeriesPoint(BaseModel):
    day: date
    balance: Decimal


class ForecastPoint(BaseModel):
    day: date
    expected: Decimal
    optimistic: Decimal
    pessimistic: Decimal


class ForecastEvent(BaseModel):
    day: date
    label: str
    amount: Decimal
    series_id: int | None = None


class ForecastOut(BaseModel):
    ledger_id: int
    ledger_name: str
    currency: str
    starting_balance: Decimal
    horizon_days: int
    threshold: Decimal
    points: list[ForecastPoint]
    events: list[ForecastEvent]
    # Primer dia en que la projeccio esperada baixa del llindar.
    first_breach_day: date | None = None
    first_breach_amount: Decimal | None = None
    daily_discretionary: Decimal


class RecurringSeriesOut(ORMModel):
    id: int
    ledger_id: int
    label: str
    merchant_id: int | None
    category_id: int | None
    category_name: str | None = None
    cadence: Cadence
    expected_amount: Decimal
    amount_tolerance: Decimal
    interval_days: int
    monthly_cost: Decimal
    confidence: float
    occurrences_count: int
    first_seen_date: date
    last_seen_date: date
    next_expected_date: date | None
    is_subscription: bool
    status: SeriesStatus
    include_in_forecast: bool


class RecurringSeriesUpdate(BaseModel):
    label: str | None = None
    include_in_forecast: bool | None = None
    is_subscription: bool | None = None
    status: SeriesStatus | None = None
    expected_amount: Decimal | None = None


class AlertOut(ORMModel):
    id: int
    ledger_id: int | None
    type: AlertType
    severity: AlertSeverity
    status: AlertStatus
    title: str
    body: str
    payload: dict
    created_at: datetime
    notified_at: datetime | None


class ReportRequest(BaseModel):
    ledger_ids: list[int] = []
    date_from: date | None = None
    date_to: date | None = None
