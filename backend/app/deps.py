"""Dependencies de FastAPI: usuari autenticat i control d'acces per llibre."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import hash_token
from app.core.time import utcnow
from app.db import get_db
from app.models import Ledger, LedgerPermission, User, UserSession
from app.models.enums import LedgerRole

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: DbSession) -> User:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticat")

    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if session is None or session.expires_at <= utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessio caducada")

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuari no valid")

    # Nomes escrivim si ha passat prou estona, per no fer un UPDATE a cada peticio.
    now = utcnow()
    if (now - session.last_seen_at).total_seconds() > 300:
        session.last_seen_at = now
        db.commit()

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cal ser administrador")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def accessible_ledger_ids(
    db: Session, user: User, min_role: LedgerRole = LedgerRole.VIEWER
) -> list[int]:
    """Identificadors dels llibres que l'usuari pot veure amb el rol demanat.

    Tota consulta de dades ha de filtrar per aquesta llista: mai per un
    identificador de llibre que vingui del client sense comprovar.
    """
    if user.is_admin:
        return list(db.scalars(select(Ledger.id).where(Ledger.is_active.is_(True))))

    allowed: list[int] = []
    for permission in db.scalars(
        select(LedgerPermission).where(LedgerPermission.user_id == user.id)
    ):
        if permission.role.level >= min_role.level:
            allowed.append(permission.ledger_id)
    return allowed


def resolve_ledger_scope(
    db: Session,
    user: User,
    requested: list[int] | None,
    min_role: LedgerRole = LedgerRole.VIEWER,
) -> list[int]:
    """Interseca els llibres demanats amb els permesos.

    Si el client no en demana cap, retorna tots els permesos (vista consolidada).
    Si en demana algun que no li pertoca, es rebutja la peticio sencera.
    """
    allowed = accessible_ledger_ids(db, user, min_role)
    if not requested:
        return allowed
    invalid = set(requested) - set(allowed)
    if invalid:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sense acces a algun dels llibres demanats")
    return list(requested)


def require_ledger_access(ledger_id: int, min_role: LedgerRole = LedgerRole.VIEWER):
    """Genera una dependencia que comprova l'acces a un llibre concret."""

    def dependency(db: DbSession, user: CurrentUser) -> Ledger:
        ledger = db.get(Ledger, ledger_id)
        if ledger is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Llibre no trobat")
        if ledger_id not in accessible_ledger_ids(db, user, min_role):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sense acces a aquest llibre")
        return ledger

    return dependency


def get_ledger_or_403(
    db: Session, user: User, ledger_id: int, min_role: LedgerRole = LedgerRole.VIEWER
) -> Ledger:
    """Versio directa, per fer servir dins del cos d'un endpoint."""
    ledger = db.get(Ledger, ledger_id)
    if ledger is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Llibre no trobat")
    if ledger_id not in accessible_ledger_ids(db, user, min_role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sense acces a aquest llibre")
    return ledger
