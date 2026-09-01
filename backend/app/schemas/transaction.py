"""Esquemes de moviments, categories, comercos i regles."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import (
    CategoryKind,
    CategorySource,
    RuleField,
    RuleOperator,
    RuleSource,
    TransactionStatus,
)
from app.schemas.common import ORMModel


class CategoryOut(ORMModel):
    id: int
    parent_id: int | None
    slug: str
    name: str
    full_name: str
    kind: CategoryKind
    color: str
    icon: str
    is_system: bool
    is_subscription: bool
    transaction_count: int = 0
    total_amount: Decimal = Decimal(0)


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: CategoryKind
    parent_id: int | None = None
    color: str = "#94a3b8"
    icon: str = ""
    is_subscription: bool = False


class CategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    color: str | None = None
    icon: str | None = None
    is_subscription: bool | None = None


class MerchantOut(ORMModel):
    id: int
    normalized_name: str
    display_name: str
    default_category_id: int | None
    category_source: CategorySource
    is_confirmed: bool
    transaction_count: int
    last_seen_at: date | None


class MerchantUpdate(BaseModel):
    display_name: str | None = None
    default_category_id: int | None = None
    # Aplica la categoria a tots els moviments existents d'aquest comerc.
    apply_to_existing: bool = True


class TransactionOut(ORMModel):
    id: int
    account_id: int
    ledger_id: int | None
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    status: TransactionStatus
    description: str
    normalized_description: str
    counterparty: str
    merchant_id: int | None
    merchant_name: str | None = None
    category_id: int | None
    category_name: str | None = None
    category_source: CategorySource
    category_confidence: float | None
    needs_review: bool
    transfer_group_id: str | None
    notes: str
    tags: list[str]
    is_excluded: bool


class TransactionUpdate(BaseModel):
    category_id: int | None = None
    notes: str | None = None
    tags: list[str] | None = None
    is_excluded: bool | None = None
    # Recorda la decisio per a aquest comerc i la aplica als moviments futurs.
    remember_merchant: bool = True
    # A mes, crea una regla explicita.
    create_rule: bool = False


class BulkCategorize(BaseModel):
    transaction_ids: list[int] = Field(min_length=1)
    category_id: int | None
    remember_merchant: bool = True


class RuleCondition(BaseModel):
    field: RuleField
    operator: RuleOperator
    value: str


class RuleOut(ORMModel):
    id: int
    name: str
    ledger_id: int | None
    priority: int
    is_active: bool
    conditions: list[RuleCondition]
    set_category_id: int | None
    set_merchant_id: int | None
    set_tags: list[str]
    source: RuleSource
    match_count: int


class RuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    ledger_id: int | None = None
    priority: int = 100
    conditions: list[RuleCondition] = Field(min_length=1)
    set_category_id: int | None = None
    set_merchant_id: int | None = None
    set_tags: list[str] = []
    # Aplica la regla immediatament als moviments ja importats.
    apply_now: bool = True


class RuleUpdate(BaseModel):
    name: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    conditions: list[RuleCondition] | None = None
    set_category_id: int | None = None
    set_tags: list[str] | None = None


class ReviewItem(BaseModel):
    transaction: TransactionOut
    suggested_category_id: int | None = None
    suggested_category_name: str | None = None
    confidence: float | None = None
    rationale: str = ""
