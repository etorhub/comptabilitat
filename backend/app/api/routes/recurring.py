"""Moviments recurrents i subscripcions."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession, get_ledger_or_403, resolve_ledger_scope
from app.models import RecurringSeries, Transaction
from app.models.enums import LedgerRole, SeriesStatus
from app.schemas.analytics import RecurringSeriesOut, RecurringSeriesUpdate
from app.schemas.transaction import TransactionOut

router = APIRouter(prefix="/recurring", tags=["recurrents"])


def _to_out(series: RecurringSeries) -> RecurringSeriesOut:
    data = RecurringSeriesOut.model_validate(series)
    data.category_name = series.category.full_name if series.category else None
    return data


@router.get("", response_model=list[RecurringSeriesOut])
def list_series(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    only_subscriptions: bool = False,
    include_ended: bool = False,
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    if not scope:
        return []

    query = select(RecurringSeries).where(RecurringSeries.ledger_id.in_(scope))
    if only_subscriptions:
        query = query.where(RecurringSeries.is_subscription.is_(True))
    if not include_ended:
        query = query.where(RecurringSeries.status == SeriesStatus.ACTIVE)

    series = db.scalars(query.order_by(RecurringSeries.next_expected_date)).all()
    return [_to_out(item) for item in series]


@router.get("/summary", response_model=dict[str, Decimal])
def subscriptions_summary(
    db: DbSession, user: CurrentUser, ledger_ids: list[int] | None = Query(default=None)
):
    """Cost mensual i anual de tot el que es paga de manera recurrent."""
    scope = resolve_ledger_scope(db, user, ledger_ids)
    if not scope:
        return {"mensual": Decimal("0.00"), "anual": Decimal("0.00")}

    monthly = Decimal("0.00")
    for series in db.scalars(
        select(RecurringSeries).where(
            RecurringSeries.ledger_id.in_(scope),
            RecurringSeries.status == SeriesStatus.ACTIVE,
            RecurringSeries.expected_amount < 0,
        )
    ):
        monthly += series.monthly_cost

    monthly = abs(monthly).quantize(Decimal("0.01"))
    return {"mensual": monthly, "anual": (monthly * 12).quantize(Decimal("0.01"))}


@router.get("/{series_id}/occurrences", response_model=list[TransactionOut])
def series_occurrences(series_id: int, db: DbSession, user: CurrentUser, limit: int = 36):
    series = db.get(RecurringSeries, series_id)
    if series is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Serie no trobada")
    get_ledger_or_403(db, user, series.ledger_id)

    from app.api.routes.transactions import to_out
    from app.models import RecurringOccurrence

    rows = db.scalars(
        select(Transaction)
        .join(RecurringOccurrence, RecurringOccurrence.transaction_id == Transaction.id)
        .where(RecurringOccurrence.series_id == series_id)
        .order_by(Transaction.booking_date.desc())
        .limit(limit)
    ).all()
    return [to_out(item) for item in rows]


@router.patch("/{series_id}", response_model=RecurringSeriesOut)
def update_series(series_id: int, payload: RecurringSeriesUpdate, db: DbSession, user: CurrentUser):
    series = db.get(RecurringSeries, series_id)
    if series is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Serie no trobada")
    get_ledger_or_403(db, user, series.ledger_id, LedgerRole.EDITOR)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(series, field, value)
    db.commit()
    return _to_out(series)
