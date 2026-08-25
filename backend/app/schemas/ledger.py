"""Esquemes de llibres."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class LedgerOut(ORMModel):
    id: int
    code: str
    name: str
    description: str
    currency: str
    color: str
    overdraft_threshold: Decimal
    position: int
    is_active: bool


class LedgerCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    currency: str = "EUR"
    color: str = "#2563eb"
    overdraft_threshold: Decimal = Decimal("0.00")


class LedgerUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    overdraft_threshold: Decimal | None = None
    position: int | None = None
    is_active: bool | None = None
