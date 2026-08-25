"""Administracio d'usuaris i permisos per llibre."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.deps import AdminUser, DbSession
from app.models import Ledger, LedgerPermission, User, UserSession
from app.schemas.auth import LedgerAccess, PermissionSet, UserCreate, UserOut, UserUpdate
from app.schemas.common import Message

router = APIRouter(prefix="/users", tags=["users"])


def _permissions_for(db: DbSession, user_id: int) -> list[LedgerAccess]:
    permissions = db.scalars(
        select(LedgerPermission).where(LedgerPermission.user_id == user_id)
    ).all()
    return [
        LedgerAccess(
            ledger_id=p.ledger_id,
            ledger_code=p.ledger.code,
            ledger_name=p.ledger.name,
            role=p.role,
        )
        for p in permissions
        if p.ledger is not None
    ]


@router.get("", response_model=list[UserOut])
def list_users(db: DbSession, admin: AdminUser):
    return list(db.scalars(select(User).order_by(User.email)))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DbSession, admin: AdminUser):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ja existeix un usuari amb aquest correu")
    user = User(
        email=email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
    )
    db.add(user)
    db.commit()
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: DbSession, admin: AdminUser):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuari no trobat")
    data = payload.model_dump(exclude_unset=True)
    if (password := data.pop("password", None)) is not None:
        user.password_hash = hash_password(password)
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    if data.get("is_admin") is False and user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No et pots treure a tu mateix l'admin")
    for field, value in data.items():
        setattr(user, field, value)
    db.commit()
    return user


@router.delete("/{user_id}", response_model=Message)
def delete_user(user_id: int, db: DbSession, admin: AdminUser):
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No et pots esborrar a tu mateix")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuari no trobat")
    db.delete(user)
    db.commit()
    return Message(message="Usuari esborrat")


@router.get("/{user_id}/permissions", response_model=list[LedgerAccess])
def list_permissions(user_id: int, db: DbSession, admin: AdminUser):
    return _permissions_for(db, user_id)


@router.put("/{user_id}/permissions", response_model=list[LedgerAccess])
def set_permissions(user_id: int, payload: list[PermissionSet], db: DbSession, admin: AdminUser):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuari no trobat")

    ledger_ids = {item.ledger_id for item in payload}
    found = set(db.scalars(select(Ledger.id).where(Ledger.id.in_(ledger_ids))))
    if missing := ledger_ids - found:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Llibres inexistents: {sorted(missing)}")

    db.execute(delete(LedgerPermission).where(LedgerPermission.user_id == user_id))
    for item in payload:
        db.add(LedgerPermission(user_id=user_id, ledger_id=item.ledger_id, role=item.role))
    db.commit()
    return _permissions_for(db, user_id)
