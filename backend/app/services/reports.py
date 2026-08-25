"""Agregats per als panells i els informes.

Els traspassos entre comptes propis i els moviments marcats com a exclosos no
compten mai com a ingres ni com a despesa: nomes mouen diner de lloc.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from app.core.time import today_local
from app.models import Category, Merchant, Transaction
from app.models.enums import TransactionStatus


def base_filter(
    query: Select,
    ledger_ids: list[int],
    date_from: date | None = None,
    date_to: date | None = None,
) -> Select:
    query = query.where(
        Transaction.ledger_id.in_(ledger_ids),
        Transaction.transfer_group_id.is_(None),
        Transaction.is_excluded.is_(False),
        Transaction.status == TransactionStatus.BOOKED,
    )
    if date_from is not None:
        query = query.where(Transaction.booking_date >= date_from)
    if date_to is not None:
        query = query.where(Transaction.booking_date <= date_to)
    return query


def month_bounds(reference: date | None = None) -> tuple[date, date]:
    reference = reference or today_local()
    first = reference.replace(day=1)
    if first.month == 12:
        next_first = first.replace(year=first.year + 1, month=1)
    else:
        next_first = first.replace(month=first.month + 1)
    return first, next_first


def income_and_expenses(
    db: Session, ledger_ids: list[int], date_from: date | None, date_to: date | None
) -> tuple[Decimal, Decimal]:
    """Retorna (ingressos, despeses) del periode; les despeses en positiu."""
    if not ledger_ids:
        return Decimal("0.00"), Decimal("0.00")

    row = db.execute(
        base_filter(
            select(
                func.coalesce(
                    func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)), 0
                ),
                func.coalesce(
                    func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0)), 0
                ),
            ),
            ledger_ids,
            date_from,
            date_to,
        )
    ).one()
    return Decimal(row[0]), Decimal(row[1])


def monthly_series(
    db: Session, ledger_ids: list[int], date_from: date, date_to: date
) -> list[dict]:
    """Ingressos, despeses i resultat de cada mes."""
    if not ledger_ids:
        return []

    period = func.to_char(Transaction.booking_date, "YYYY-MM").label("period")
    rows = db.execute(
        base_filter(
            select(
                period,
                func.coalesce(
                    func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)), 0
                ),
                func.coalesce(
                    func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0)), 0
                ),
            ),
            ledger_ids,
            date_from,
            date_to,
        )
        .group_by(period)
        .order_by(period)
    ).all()

    return [
        {
            "period": row[0],
            "income": Decimal(row[1]),
            "expenses": Decimal(row[2]),
            "net": Decimal(row[1]) - Decimal(row[2]),
        }
        for row in rows
    ]


def category_breakdown(
    db: Session,
    ledger_ids: list[int],
    date_from: date | None,
    date_to: date | None,
    expenses: bool = True,
    limit: int = 30,
) -> list[dict]:
    """Repartiment per categoria, agrupant pel pare quan n'hi ha."""
    if not ledger_ids:
        return []

    parent = Category.__table__.alias("parent")
    sign_filter = Transaction.amount < 0 if expenses else Transaction.amount > 0
    total_expression = func.sum(func.abs(Transaction.amount))
    # Els moviments d'una subcategoria s'agrupen sota el seu pare; els que no en
    # tenen (o no estan classificats) es queden com estan.
    group_id = func.coalesce(parent.c.id, Category.id)
    group_name = func.coalesce(parent.c.name, Category.name)
    group_color = func.coalesce(parent.c.color, Category.color)

    query = (
        base_filter(
            select(
                group_id.label("group_id"),
                group_name.label("group_name"),
                group_color.label("color"),
                total_expression.label("amount"),
                func.count(Transaction.id).label("transactions"),
            ),
            ledger_ids,
            date_from,
            date_to,
        )
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .join(parent, parent.c.id == Category.parent_id, isouter=True)
        .where(sign_filter)
        .group_by(group_id, group_name, group_color)
        .order_by(total_expression.desc())
        .limit(limit)
    )
    rows = db.execute(query).all()
    total = sum((Decimal(row.amount) for row in rows), Decimal("0.00"))

    return [
        {
            "category_id": row.group_id,
            "category_name": row.group_name or "Sense classificar",
            "color": row.color or "#94a3b8",
            "amount": Decimal(row.amount),
            "share": float(Decimal(row.amount) / total) if total else 0.0,
            "transactions": int(row.transactions),
        }
        for row in rows
    ]


def merchant_breakdown(
    db: Session,
    ledger_ids: list[int],
    date_from: date | None,
    date_to: date | None,
    limit: int = 20,
) -> list[dict]:
    """Comercos on mes s'ha gastat en el periode."""
    if not ledger_ids:
        return []

    total_expression = func.sum(func.abs(Transaction.amount))
    rows = db.execute(
        base_filter(
            select(
                Merchant.id,
                Merchant.display_name,
                total_expression.label("amount"),
                func.count(Transaction.id).label("transactions"),
            ),
            ledger_ids,
            date_from,
            date_to,
        )
        .join(Merchant, Merchant.id == Transaction.merchant_id)
        .where(Transaction.amount < 0)
        .group_by(Merchant.id, Merchant.display_name)
        .order_by(total_expression.desc())
        .limit(limit)
    ).all()

    return [
        {
            "merchant_id": row.id,
            "merchant_name": row.display_name,
            "amount": Decimal(row.amount),
            "transactions": int(row.transactions),
        }
        for row in rows
    ]


def count_pending_review(db: Session, ledger_ids: list[int]) -> int:
    if not ledger_ids:
        return 0
    return int(
        db.scalar(
            select(func.count(Transaction.id)).where(
                Transaction.ledger_id.in_(ledger_ids), Transaction.needs_review.is_(True)
            )
        )
        or 0
    )


def count_uncategorized(db: Session, ledger_ids: list[int]) -> int:
    if not ledger_ids:
        return 0
    return int(
        db.scalar(
            select(func.count(Transaction.id)).where(
                Transaction.ledger_id.in_(ledger_ids),
                Transaction.category_id.is_(None),
                Transaction.transfer_group_id.is_(None),
            )
        )
        or 0
    )
