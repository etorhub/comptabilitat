"""Exportacio dels moviments i dels informes."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.core.time import today_local
from app.deps import CurrentUser, DbSession, resolve_ledger_scope
from app.models import Ledger, Transaction
from app.services import reports
from app.services.export import (
    report_to_pdf,
    summary_to_xlsx,
    transactions_to_csv,
    transactions_to_xlsx,
)

router = APIRouter(prefix="/export", tags=["exportacio"])

MAX_ROWS = 20000


def _load(
    db: DbSession,
    scope: list[int],
    date_from: date | None,
    date_to: date | None,
    search: str | None,
    category_ids: list[int] | None,
) -> list[Transaction]:
    query = select(Transaction).where(Transaction.ledger_id.in_(scope))
    if date_from is not None:
        query = query.where(Transaction.booking_date >= date_from)
    if date_to is not None:
        query = query.where(Transaction.booking_date <= date_to)
    if category_ids:
        query = query.where(Transaction.category_id.in_(category_ids))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(Transaction.description.ilike(pattern))
    return list(
        db.scalars(
            query.order_by(Transaction.booking_date.desc(), Transaction.id.desc()).limit(MAX_ROWS)
        )
    )


def _filename(prefix: str, extension: str) -> str:
    return f"{prefix}-{today_local():%Y%m%d}.{extension}"


def _attachment(content: bytes, filename: str, media_type: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/transactions.csv")
def export_csv(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    category_ids: list[int] | None = Query(default=None),
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    rows = _load(db, scope, date_from, date_to, search, category_ids) if scope else []
    return _attachment(
        transactions_to_csv(rows), _filename("moviments", "csv"), "text/csv; charset=utf-8"
    )


@router.get("/transactions.xlsx")
def export_xlsx(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    category_ids: list[int] | None = Query(default=None),
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    rows = _load(db, scope, date_from, date_to, search, category_ids) if scope else []
    return _attachment(
        transactions_to_xlsx(rows),
        _filename("moviments", "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/report.xlsx")
def export_report_xlsx(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    months: int = Query(default=12, ge=1, le=60),
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    date_to = today_local()
    date_from = (date_to.replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1)
    monthly = reports.monthly_series(db, scope, date_from, date_to)
    categories = reports.category_breakdown(db, scope, date_from, date_to)
    return _attachment(
        summary_to_xlsx(monthly, categories),
        _filename("informe", "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/report.pdf")
def export_report_pdf(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    date_from: date | None = None,
    date_to: date | None = None,
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    date_to = date_to or today_local()
    date_from = date_from or date_to.replace(day=1)

    income, expenses = reports.income_and_expenses(db, scope, date_from, date_to)
    monthly = reports.monthly_series(db, scope, date_from, date_to)
    categories = reports.category_breakdown(db, scope, date_from, date_to)

    names = (
        [ledger.name for ledger in db.scalars(select(Ledger).where(Ledger.id.in_(scope)))]
        if scope
        else []
    )
    subtitle = (
        f"{', '.join(names) or 'Sense llibres'} · del {date_from:%d/%m/%Y} al {date_to:%d/%m/%Y}"
    )

    content = report_to_pdf(
        title="Informe de comptabilitat",
        subtitle=subtitle,
        summary={
            "Ingressos": income,
            "Despeses": expenses,
            "Resultat": income - expenses,
        },
        monthly=monthly,
        categories=categories,
    )
    return _attachment(content, _filename("informe", "pdf"), "application/pdf")
