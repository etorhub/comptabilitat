"""Llibres comptables."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import AdminUser, CurrentUser, DbSession, accessible_ledger_ids, get_ledger_or_403
from app.models import Ledger
from app.models.enums import LedgerRole
from app.schemas.ledger import LedgerCreate, LedgerOut, LedgerUpdate

router = APIRouter(prefix="/ledgers", tags=["ledgers"])


@router.get("", response_model=list[LedgerOut])
def list_ledgers(db: DbSession, user: CurrentUser):
    allowed = accessible_ledger_ids(db, user)
    if not allowed:
        return []
    ledgers = db.scalars(
        select(Ledger).where(Ledger.id.in_(allowed)).order_by(Ledger.position, Ledger.name)
    ).all()
    return list(ledgers)


@router.post("", response_model=LedgerOut, status_code=status.HTTP_201_CREATED)
def create_ledger(payload: LedgerCreate, db: DbSession, user: AdminUser):
    if db.scalar(select(Ledger).where(Ledger.code == payload.code)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ja existeix un llibre amb aquest codi")
    ledger = Ledger(**payload.model_dump())
    db.add(ledger)
    db.commit()
    return ledger


@router.get("/{ledger_id}", response_model=LedgerOut)
def get_ledger(ledger_id: int, db: DbSession, user: CurrentUser):
    return get_ledger_or_403(db, user, ledger_id)


@router.patch("/{ledger_id}", response_model=LedgerOut)
def update_ledger(ledger_id: int, payload: LedgerUpdate, db: DbSession, user: CurrentUser):
    ledger = get_ledger_or_403(db, user, ledger_id, LedgerRole.ADMIN)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(ledger, field, value)
    db.commit()
    return ledger
