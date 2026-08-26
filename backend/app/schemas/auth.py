"""Esquemes d'autenticacio i usuaris."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import LedgerRole
from app.schemas.common import ORMModel


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)


class LedgerAccess(ORMModel):
    ledger_id: int
    ledger_code: str
    ledger_name: str
    role: LedgerRole


class UserOut(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    is_admin: bool
    is_active: bool
    last_login_at: datetime | None = None


class CurrentUserOut(UserOut):
    """L'usuari autenticat. Els espais on te acces es demanen a /api/workspaces."""


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = ""
    password: str = Field(min_length=10)
    is_admin: bool = False


class UserUpdate(BaseModel):
    full_name: str | None = None
    is_admin: bool | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10)


class PermissionSet(BaseModel):
    ledger_id: int
    role: LedgerRole
