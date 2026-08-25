"""Consultes de saldos."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, Balance, Transaction

# Ordre de preferencia: saldo comptable tancat, disponible, i despres qualsevol.
BALANCE_TYPE_PRIORITY = ["CLBD", "CLAV", "ITAV", "XPCD", "OTHR"]


def latest_balance(db: Session, account_id: int) -> Balance | None:
    """Ultim saldo conegut d'un compte, preferint el saldo comptable."""
    latest_date = db.scalar(
        select(func.max(Balance.reference_date)).where(Balance.account_id == account_id)
    )
    if latest_date is None:
        return None
    candidates = list(
        db.scalars(
            select(Balance).where(
                Balance.account_id == account_id, Balance.reference_date == latest_date
            )
        )
    )
    if not candidates:
        return None
    candidates.sort(
        key=lambda item: (
            BALANCE_TYPE_PRIORITY.index(item.balance_type)
            if item.balance_type in BALANCE_TYPE_PRIORITY
            else len(BALANCE_TYPE_PRIORITY)
        )
    )
    return candidates[0]


def ledger_balance(db: Session, ledger_id: int) -> tuple[Decimal, date | None]:
    """Suma dels ultims saldos coneguts dels comptes d'un llibre."""
    total = Decimal("0.00")
    newest: date | None = None
    for account in db.scalars(
        select(Account).where(Account.ledger_id == ledger_id, Account.is_active.is_(True))
    ):
        balance = latest_balance(db, account.id)
        if balance is None:
            continue
        total += balance.amount
        if newest is None or balance.reference_date > newest:
            newest = balance.reference_date
    return total, newest


def balance_series(
    db: Session, ledger_ids: list[int], date_from: date, date_to: date
) -> list[tuple[date, Decimal]]:
    """Evolucio diaria del saldo, reconstruida cap enrere des del saldo actual.

    Els bancs nomes donen el saldo d'avui, aixi que la corba historica es
    calcula restant els moviments dia a dia a partir del saldo conegut.
    """
    if not ledger_ids:
        return []

    current = Decimal("0.00")
    for ledger_id in ledger_ids:
        amount, _ = ledger_balance(db, ledger_id)
        current += amount

    rows = db.execute(
        select(Transaction.booking_date, func.sum(Transaction.amount))
        .where(
            Transaction.ledger_id.in_(ledger_ids),
            Transaction.booking_date > date_from,
            Transaction.booking_date <= date_to,
        )
        .group_by(Transaction.booking_date)
    ).all()
    daily = {row[0]: Decimal(row[1] or 0) for row in rows}

    series: list[tuple[date, Decimal]] = []
    cursor = date_to
    running = current
    while cursor >= date_from:
        series.append((cursor, running))
        running -= daily.get(cursor, Decimal("0.00"))
        cursor -= timedelta(days=1)
    series.reverse()
    return series
