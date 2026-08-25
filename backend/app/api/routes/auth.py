"""Inici i tancament de sessio."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from app.config import settings
from app.core.security import (
    generate_session_token,
    hash_password,
    hash_token,
    needs_rehash,
    verify_password,
)
from app.core.time import utcnow
from app.deps import CurrentUser, DbSession
from app.models import LedgerPermission, User, UserSession
from app.schemas.auth import CurrentUserOut, LedgerAccess, LoginRequest, PasswordChange
from app.schemas.common import Message

router = APIRouter(prefix="/auth", tags=["auth"])


def _build_current_user(db: DbSession, user: User) -> CurrentUserOut:
    permissions = db.scalars(
        select(LedgerPermission).where(LedgerPermission.user_id == user.id)
    ).all()
    ledgers = [
        LedgerAccess(
            ledger_id=permission.ledger_id,
            ledger_code=permission.ledger.code,
            ledger_name=permission.ledger.name,
            role=permission.role,
        )
        for permission in permissions
        if permission.ledger is not None
    ]
    return CurrentUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        last_login_at=user.last_login_at,
        ledgers=ledgers,
    )


@router.post("/login", response_model=CurrentUserOut)
def login(payload: LoginRequest, request: Request, response: Response, db: DbSession):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    # Es comprova la contrasenya encara que l'usuari no existeixi, per no filtrar
    # quins correus estan donats d'alta a traves del temps de resposta.
    password_hash = user.password_hash if user else hash_password("versio-inexistent")
    valid = verify_password(payload.password, password_hash)
    if user is None or not valid or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credencials incorrectes")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    now = utcnow()
    token = generate_session_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=settings.session_max_age_days),
            user_agent=(request.headers.get("user-agent") or "")[:255],
        )
    )
    user.last_login_at = now
    db.commit()

    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_max_age_days * 24 * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return _build_current_user(db, user)


@router.post("/logout", response_model=Message)
def logout(request: Request, response: Response, db: DbSession):
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
        db.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")
    return Message(message="Sessio tancada")


@router.get("/me", response_model=CurrentUserOut)
def me(user: CurrentUser, db: DbSession):
    return _build_current_user(db, user)


@router.post("/password", response_model=Message)
def change_password(payload: PasswordChange, user: CurrentUser, db: DbSession):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contrasenya actual no es correcta")
    user.password_hash = hash_password(payload.new_password)
    # Tanca la resta de sessions obertes.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    return Message(message="Contrasenya actualitzada. Torna a iniciar sessio.")
