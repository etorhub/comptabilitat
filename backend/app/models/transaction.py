"""Categories, comercos, moviments, regles i suggeriments del model local."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_column, money_column
from app.models.enums import (
    CategoryKind,
    CategorySource,
    RuleSource,
    TransactionSource,
    TransactionStatus,
)

if TYPE_CHECKING:
    from app.models.banking import Account
    from app.models.ledger import Ledger


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[CategoryKind] = enum_column(CategoryKind, nullable=False)
    color: Mapped[str] = mapped_column(String(9), nullable=False, default="#94a3b8")
    icon: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    parent: Mapped[Category | None] = relationship(remote_side="Category.id", lazy="selectin")

    @property
    def full_name(self) -> str:
        return f"{self.parent.name} › {self.name}" if self.parent else self.name


class Merchant(Base, TimestampMixin):
    """Memoria de comercos: cada comerc es classifica una sola vegada."""

    __tablename__ = "merchants"

    id: Mapped[int] = mapped_column(primary_key=True)
    normalized_name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    default_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    # Com s'ha determinat la categoria per defecte del comerc.
    category_source: Mapped[CategorySource] = enum_column(
        CategorySource, nullable=False, default=CategorySource.NONE
    )
    # Cert quan un huma ha validat el comerc: la IA ja no l'ha de tornar a mirar.
    is_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    transaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_seen_at: Mapped[date | None] = mapped_column(Date)

    default_category: Mapped[Category | None] = relationship(lazy="selectin")


class Transaction(Base, TimestampMixin):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("account_id", "dedup_key", name="uq_transaction_account_dedup"),
        Index("ix_transactions_ledger_booking", "ledger_id", "booking_date"),
        Index("ix_transactions_review", "needs_review", "ledger_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Desnormalitzat des del compte per poder filtrar per llibre sense join.
    ledger_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledgers.id", ondelete="SET NULL"), index=True
    )

    # --- Identitat i deduplicacio ---
    entry_reference: Mapped[str | None] = mapped_column(String(128))
    transaction_id: Mapped[str | None] = mapped_column(String(128))
    dedup_key: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[TransactionSource] = enum_column(
        TransactionSource, nullable=False, default=TransactionSource.ENABLEBANKING
    )

    # --- Dades del moviment ---
    booking_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    value_date: Mapped[date | None] = mapped_column(Date)
    # Import amb signe: negatiu = sortida de diners.
    amount: Mapped[Decimal] = money_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    status: Mapped[TransactionStatus] = enum_column(
        TransactionStatus, nullable=False, default=TransactionStatus.BOOKED
    )
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    normalized_description: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    counterparty: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    bank_transaction_code: Mapped[str] = mapped_column(String(60), nullable=False, default="")

    # --- Classificacio ---
    merchant_id: Mapped[int | None] = mapped_column(
        ForeignKey("merchants.id", ondelete="SET NULL"), index=True
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    category_source: Mapped[CategorySource] = enum_column(
        CategorySource, nullable=False, default=CategorySource.NONE
    )
    category_confidence: Mapped[float | None] = mapped_column(Float)
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    applied_rule_id: Mapped[int | None] = mapped_column(ForeignKey("rules.id", ondelete="SET NULL"))

    # --- Traspassos entre comptes propis ---
    transfer_group_id: Mapped[str | None] = mapped_column(String(64), index=True)

    # --- Anotacions de l'usuari ---
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False, default=list)
    is_excluded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    account: Mapped[Account] = relationship(back_populates="transactions")
    ledger: Mapped[Ledger | None] = relationship()
    category: Mapped[Category | None] = relationship(lazy="selectin")
    merchant: Mapped[Merchant | None] = relationship(lazy="selectin")

    @property
    def is_expense(self) -> bool:
        return self.amount < 0


class Rule(Base, TimestampMixin):
    """Regla de classificacio. Les condicions s'avaluen totes en AND."""

    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    # Nul = s'aplica a tots els llibres.
    ledger_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledgers.id", ondelete="CASCADE"), index=True
    )
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    conditions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    set_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE")
    )
    set_merchant_id: Mapped[int | None] = mapped_column(
        ForeignKey("merchants.id", ondelete="SET NULL")
    )
    set_tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False, default=list)
    source: Mapped[RuleSource] = enum_column(RuleSource, nullable=False, default=RuleSource.USER)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    match_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    set_category: Mapped[Category | None] = relationship(lazy="selectin")


class LlmSuggestion(Base):
    """Auditoria de cada proposta del model local."""

    __tablename__ = "llm_suggestions"

    id: Mapped[int] = mapped_column(primary_key=True)
    merchant_id: Mapped[int | None] = mapped_column(
        ForeignKey("merchants.id", ondelete="CASCADE"), index=True
    )
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    input_text: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    suggested_display_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    confidence: Mapped[float | None] = mapped_column(Float)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    accepted: Mapped[bool | None] = mapped_column(Boolean)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    suggested_category: Mapped[Category | None] = relationship(lazy="selectin")
