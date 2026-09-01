"""Exportacio dels moviments i dels informes d'un espai."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.api.routes.transactions import search_clause
from app.core.time import today_local
from app.deps import DbSession, Workspace
from app.models import Transaction
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
    ledger_id: int,
    date_from: date | None,
    date_to: date | None,
    search: str | None,
    category_ids: list[int] | None,
) -> list[Transaction]:
    query = select(Transaction).where(Transaction.ledger_id == ledger_id)
    if date_from is not None:
        query = query.where(Transaction.booking_date >= date_from)
    if date_to is not None:
        query = query.where(Transaction.booking_date <= date_to)
    if category_ids:
        query = query.where(Transaction.category_id.in_(category_ids))
    if search:
        query = query.where(search_clause(f"%{search.strip()}%"))
    return list(
        db.scalars(
            query.order_by(Transaction.booking_date.desc(), Transaction.id.desc()).limit(MAX_ROWS)
        )
    )


def _filename(prefix: str, codi: str, extension: str) -> str:
    return f"{prefix}-{codi}-{today_local():%Y%m%d}.{extension}"


def _attachment(content: bytes, filename: str, media_type: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/transactions.csv")
def export_csv(
    db: DbSession,
    workspace: Workspace,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    category_ids: list[int] | None = Query(default=None),
):
    rows = _load(db, workspace.id, date_from, date_to, search, category_ids)
    return _attachment(
        transactions_to_csv(rows),
        _filename("moviments", workspace.code, "csv"),
        "text/csv; charset=utf-8",
    )


@router.get("/transactions.xlsx")
def export_xlsx(
    db: DbSession,
    workspace: Workspace,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    category_ids: list[int] | None = Query(default=None),
):
    rows = _load(db, workspace.id, date_from, date_to, search, category_ids)
    return _attachment(
        transactions_to_xlsx(rows, title=workspace.name),
        _filename("moviments", workspace.code, "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/report.xlsx")
def export_report_xlsx(
    db: DbSession,
    workspace: Workspace,
    months: int = Query(default=12, ge=1, le=60),
):
    date_to = today_local()
    date_from = (date_to.replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1)
    monthly = reports.monthly_series(db, [workspace.id], date_from, date_to)
    categories = reports.category_breakdown(db, [workspace.id], date_from, date_to)
    return _attachment(
        summary_to_xlsx(monthly, categories),
        _filename("informe", workspace.code, "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/report.pdf")
def export_report_pdf(
    db: DbSession,
    workspace: Workspace,
    date_from: date | None = None,
    date_to: date | None = None,
):
    date_to = date_to or today_local()
    date_from = date_from or date_to.replace(day=1)

    income, expenses = reports.income_and_expenses(db, [workspace.id], date_from, date_to)
    monthly = reports.monthly_series(db, [workspace.id], date_from, date_to)
    categories = reports.category_breakdown(db, [workspace.id], date_from, date_to)

    content = report_to_pdf(
        title=f"Comptabilitat de {workspace.name}",
        subtitle=f"Del {date_from:%d/%m/%Y} al {date_to:%d/%m/%Y}",
        summary={"Ingressos": income, "Despeses": expenses, "Resultat": income - expenses},
        monthly=monthly,
        categories=categories,
    )
    return _attachment(content, _filename("informe", workspace.code, "pdf"), "application/pdf")
