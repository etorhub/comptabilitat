"""Dependencies de FastAPI: usuari autenticat i espai de treball actiu.

Cada espai es una comptabilitat estanca. Les rutes de dades pengen sempre d'un
espai (`/api/workspaces/{codi}/...`) i la dependencia `workspace` comprova que
l'usuari hi tingui acces abans que el codi de la ruta vegi res.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Path, Request, status
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


def role_in(db: Session, user: User, ledger_id: int) -> LedgerRole | None:
    """Rol de l'usuari en un espai, o None si no hi te acces.

    Ser administrador de l'aplicacio no dona acces automatic a cap espai: qui
    gestiona els bancs i els usuaris no ha de veure per defecte la comptabilitat
    de tothom. L'acces s'ha de concedir espai per espai.
    """
    permission = db.scalar(
        select(LedgerPermission).where(
            LedgerPermission.user_id == user.id, LedgerPermission.ledger_id == ledger_id
        )
    )
    return permission.role if permission else None


def my_workspaces(db: Session, user: User) -> list[Ledger]:
    """Espais on l'usuari te acces, en l'ordre en que s'han de mostrar."""
    return list(
        db.scalars(
            select(Ledger)
            .join(LedgerPermission, LedgerPermission.ledger_id == Ledger.id)
            .where(LedgerPermission.user_id == user.id, Ledger.is_active.is_(True))
            .order_by(Ledger.position, Ledger.name)
        )
    )


def get_workspace(
    db: DbSession,
    user: CurrentUser,
    codi: Annotated[str, Path(description="Codi de l'espai: personal, calella…")],
) -> Ledger:
    """Resol l'espai de la ruta i comprova que l'usuari hi tingui acces."""
    ledger = db.scalar(select(Ledger).where(Ledger.code == codi))
    if ledger is None or not ledger.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Espai no trobat")
    if role_in(db, user, ledger.id) is None:
        # El mateix error que si no existis: qui no hi te acces no ha de saber
        # ni que l'espai existeix.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Espai no trobat")
    return ledger


Workspace = Annotated[Ledger, Depends(get_workspace)]


def _require_role(minim: LedgerRole):
    def dependency(db: DbSession, user: CurrentUser, workspace: Workspace) -> Ledger:
        rol = role_in(db, user, workspace.id)
        if rol is None or rol.level < minim.level:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Cal ser com a minim {minim.value} en aquest espai",
            )
        return workspace

    return dependency


# Espai on l'usuari pot editar (categoritzar, anotar, crear regles).
EditableWorkspace = Annotated[Ledger, Depends(_require_role(LedgerRole.EDITOR))]
# Espai on l'usuari el pot configurar (comptes, destinataris d'avisos, usuaris).
ManagedWorkspace = Annotated[Ledger, Depends(_require_role(LedgerRole.ADMIN))]
