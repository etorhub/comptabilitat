"""Espais de treball: llistat, configuracio i qui hi te acces."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, select

from app.deps import (
    AdminUser,
    CurrentUser,
    DbSession,
    ManagedWorkspace,
    Workspace,
    my_workspaces,
    role_in,
)
from app.models import Ledger, LedgerPermission, User
from app.schemas.common import Message
from app.schemas.ledger import (
    MemberOut,
    MemberSet,
    WorkspaceCreate,
    WorkspaceDetail,
    WorkspaceOut,
    WorkspaceUpdate,
)
from app.services.seed import seed_categories

router = APIRouter(prefix="/workspaces", tags=["espais"])


def _to_out(ledger: Ledger, role=None) -> WorkspaceOut:
    data = WorkspaceOut.model_validate(ledger)
    data.role = role
    return data


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(db: DbSession, user: CurrentUser):
    """Espais on l'usuari te acces. No n'hi ha cap de consolidat."""
    return [_to_out(ledger, role_in(db, user, ledger.id)) for ledger in my_workspaces(db, user)]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(payload: WorkspaceCreate, db: DbSession, admin: AdminUser):
    """Crea un espai amb el seu propi pla de categories i hi dona acces al creador."""
    from app.models.enums import LedgerRole

    if db.scalar(select(Ledger).where(Ledger.code == payload.code)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ja existeix un espai amb aquest codi")

    ledger = Ledger(**payload.model_dump())
    db.add(ledger)
    db.flush()
    seed_categories(db, ledger.id)
    db.add(LedgerPermission(user_id=admin.id, ledger_id=ledger.id, role=LedgerRole.ADMIN))
    db.commit()
    return _to_out(ledger, LedgerRole.ADMIN)


@router.get("/{codi}", response_model=WorkspaceDetail)
def get_workspace_detail(db: DbSession, user: CurrentUser, workspace: Workspace):
    data = WorkspaceDetail.model_validate(workspace)
    data.role = role_in(db, user, workspace.id)
    return data


@router.patch("/{codi}", response_model=WorkspaceDetail)
def update_workspace(payload: WorkspaceUpdate, db: DbSession, workspace: ManagedWorkspace):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(workspace, field, value)
    db.commit()
    return WorkspaceDetail.model_validate(workspace)


@router.get("/{codi}/members", response_model=list[MemberOut])
def list_members(db: DbSession, workspace: ManagedWorkspace):
    rows = db.execute(
        select(User, LedgerPermission.role)
        .join(LedgerPermission, LedgerPermission.user_id == User.id)
        .where(LedgerPermission.ledger_id == workspace.id)
        .order_by(User.email)
    ).all()
    return [
        MemberOut(user_id=user.id, email=user.email, full_name=user.full_name, role=role)
        for user, role in rows
    ]


@router.put("/{codi}/members", response_model=list[MemberOut])
def set_members(
    payload: list[MemberSet], db: DbSession, user: CurrentUser, workspace: ManagedWorkspace
):
    """Substitueix la llista de qui te acces a l'espai."""
    ids = {item.user_id for item in payload}
    trobats = set(db.scalars(select(User.id).where(User.id.in_(ids))))
    if desconeguts := ids - trobats:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Usuaris inexistents: {sorted(desconeguts)}"
        )
    if user.id not in ids:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No et pots treure a tu mateix de l'espai: quedaria sense ningu que el gestioni",
        )

    db.execute(delete(LedgerPermission).where(LedgerPermission.ledger_id == workspace.id))
    for item in payload:
        db.add(LedgerPermission(user_id=item.user_id, ledger_id=workspace.id, role=item.role))
    db.commit()
    return list_members(db, workspace)


@router.delete("/{codi}/members/{user_id}", response_model=Message)
def remove_member(user_id: int, db: DbSession, user: CurrentUser, workspace: ManagedWorkspace):
    if user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No et pots treure a tu mateix")
    db.execute(
        delete(LedgerPermission).where(
            LedgerPermission.ledger_id == workspace.id, LedgerPermission.user_id == user_id
        )
    )
    db.commit()
    return Message(message="Acces retirat")
