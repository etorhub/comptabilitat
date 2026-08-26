"""Comptes bancaris d'un espai."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import DbSession, ManagedWorkspace, Workspace
from app.models import Account, Balance
from app.schemas.banking import AccountOut, AccountUpdate, BalancePoint
from app.services.balances import latest_balance

router = APIRouter(prefix="/accounts", tags=["comptes"])


def to_out(db: DbSession, account: Account) -> AccountOut:
    data = AccountOut.model_validate(
        {
            **{
                field: getattr(account, field)
                for field in (
                    "id",
                    "connection_id",
                    "ledger_id",
                    "name",
                    "product",
                    "currency",
                    "cash_account_type",
                    "is_active",
                    "history_start_date",
                    "last_booked_date",
                )
            },
            "iban_masked": account.iban_masked,
        }
    )
    balance = latest_balance(db, account.id)
    data.current_balance = balance.amount if balance else None
    return data


def _get_in_workspace(db: DbSession, workspace, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None or account.ledger_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte no trobat")
    return account


@router.get("", response_model=list[AccountOut])
def list_accounts(db: DbSession, workspace: Workspace):
    accounts = db.scalars(
        select(Account).where(Account.ledger_id == workspace.id).order_by(Account.id)
    ).all()
    return [to_out(db, account) for account in accounts]


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int, payload: AccountUpdate, db: DbSession, workspace: ManagedWorkspace
):
    """Canvia el nom o desactiva un compte de l'espai.

    Moure un compte a un altre espai no es fa des d'aqui: es fa des de la
    pantalla de connexions, perque implica reclassificar-ne tot l'historic.
    """
    account = _get_in_workspace(db, workspace, account_id)
    data = payload.model_dump(exclude_unset=True)
    data.pop("ledger_id", None)
    for field, value in data.items():
        setattr(account, field, value)
    db.commit()
    return to_out(db, account)


@router.get("/{account_id}/balances", response_model=list[BalancePoint])
def account_balances(account_id: int, db: DbSession, workspace: Workspace, limit: int = 180):
    _get_in_workspace(db, workspace, account_id)
    balances = db.scalars(
        select(Balance)
        .where(Balance.account_id == account_id)
        .order_by(Balance.reference_date.desc())
        .limit(limit)
    ).all()

    seen: set = set()
    points: list[BalancePoint] = []
    for balance in balances:
        if balance.reference_date in seen:
            continue
        seen.add(balance.reference_date)
        points.append(BalancePoint(reference_date=balance.reference_date, amount=balance.amount))
    points.reverse()
    return points
