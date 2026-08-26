"""Esquemes dels espais de treball."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import LedgerRole
from app.schemas.common import ORMModel


class WorkspaceOut(ORMModel):
    id: int
    code: str
    name: str
    description: str
    currency: str
    color: str
    overdraft_threshold: Decimal
    position: int
    is_active: bool
    # Rol de qui ho consulta dins d'aquest espai.
    role: LedgerRole | None = None


class WorkspaceDetail(WorkspaceOut):
    alert_recipients: list[EmailStr] = []


class WorkspaceCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    currency: str = "EUR"
    color: str = "#2563eb"
    overdraft_threshold: Decimal = Decimal("0.00")


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    overdraft_threshold: Decimal | None = None
    position: int | None = None
    is_active: bool | None = None
    alert_recipients: list[EmailStr] | None = None


class MemberOut(BaseModel):
    user_id: int
    email: EmailStr
    full_name: str
    role: LedgerRole


class MemberSet(BaseModel):
    user_id: int
    role: LedgerRole
