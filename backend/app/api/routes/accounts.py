"""Comptes bancaris i la seva assignacio als llibres."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select, update

from app.deps import CurrentUser, DbSession, accessible_ledger_ids, get_ledger_or_403
from app.models import Account, Balance, Transaction
from app.models.enums import LedgerRole
from app.schemas.banking import AccountOut, AccountUpdate, BalancePoint
from app.services.balances import latest_balance

router = APIRouter(prefix="/accounts", tags=["comptes"])


def _to_out(db: DbSession, account: Account) -> AccountOut:
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


@router.get("", response_model=list[AccountOut])
def list_accounts(db: DbSession, user: CurrentUser, include_unassigned: bool = True):
    """Comptes dels llibres als quals l'usuari te acces.

    Els administradors veuen tambe els comptes encara sense llibre assignat,
    perque son els que han de repartir despres de connectar el banc.
    """
    allowed = accessible_ledger_ids(db, user)
    condition = Account.ledger_id.in_(allowed) if allowed else Account.id.is_(None)
    if user.is_admin and include_unassigned:
        condition = condition | Account.ledger_id.is_(None)

    accounts = db.scalars(select(Account).where(condition).order_by(Account.id)).all()
    return [_to_out(db, account) for account in accounts]


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(account_id: int, payload: AccountUpdate, db: DbSession, user: CurrentUser):
    """Assigna el compte a un llibre o en canvia el nom.

    Canviar de llibre arrossega tots els moviments del compte, que porten el
    llibre desnormalitzat per poder-los filtrar sense join.
    """
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte no trobat")

    # Nomes un administrador pot moure comptes entre llibres; qui te el llibre
    # com a administrador pot gestionar els comptes que ja hi son.
    if account.ledger_id is None and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cal ser administrador")
    if account.ledger_id is not None:
        get_ledger_or_403(db, user, account.ledger_id, LedgerRole.ADMIN)

    data = payload.model_dump(exclude_unset=True)
    if "ledger_id" in data:
        new_ledger_id = data.pop("ledger_id")
        if new_ledger_id is not None:
            get_ledger_or_403(db, user, new_ledger_id, LedgerRole.ADMIN)
        if new_ledger_id != account.ledger_id:
            account.ledger_id = new_ledger_id
            db.execute(
                update(Transaction)
                .where(Transaction.account_id == account.id)
                .values(ledger_id=new_ledger_id)
            )

    for field, value in data.items():
        setattr(account, field, value)
    db.commit()
    return _to_out(db, account)


@router.get("/{account_id}/balances", response_model=list[BalancePoint])
def account_balances(account_id: int, db: DbSession, user: CurrentUser, limit: int = 180):
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte no trobat")
    if account.ledger_id is None:
        if not user.is_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sense acces a aquest compte")
    else:
        get_ledger_or_403(db, user, account.ledger_id)

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
