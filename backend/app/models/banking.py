"""Connexions bancaries, comptes, saldos i traca de sincronitzacions."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_column, money_column
from app.models.enums import ConnectionStatus, SyncStatus, SyncTrigger

if TYPE_CHECKING:
    from app.models.ledger import Ledger
    from app.models.transaction import Transaction


class BankConnection(Base, TimestampMixin):
    """Una autoritzacio d'Enable Banking: pot portar diversos comptes."""

    __tablename__ = "bank_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    aspsp_name: Mapped[str] = mapped_column(String(120), nullable=False)
    aspsp_country: Mapped[str] = mapped_column(String(2), nullable=False)
    psu_type: Mapped[str] = mapped_column(String(20), nullable=False, default="personal")
    eb_session_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    eb_auth_state: Mapped[str | None] = mapped_column(String(128), index=True)
    status: Mapped[ConnectionStatus] = enum_column(
        ConnectionStatus, nullable=False, default=ConnectionStatus.PENDING
    )
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    accounts: Mapped[list[Account]] = relationship(
        back_populates="connection", cascade="all, delete-orphan", lazy="selectin"
    )
    sync_runs: Mapped[list[SyncRun]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )

    @property
    def days_until_expiry(self) -> int | None:
        if self.valid_until is None:
            return None
        delta = self.valid_until - datetime.now(self.valid_until.tzinfo)
        return delta.days


class Account(Base, TimestampMixin):
    """Compte bancari, assignat a un llibre per l'usuari."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ledger_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledgers.id", ondelete="SET NULL"), index=True
    )
    eb_account_uid: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    product: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    iban: Mapped[str] = mapped_column(String(34), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    cash_account_type: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    usage: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Fins on hem arribat enrere amb l'historic i fins on hem sincronitzat endavant.
    history_start_date: Mapped[date | None] = mapped_column(Date)
    last_booked_date: Mapped[date | None] = mapped_column(Date)
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    connection: Mapped[BankConnection] = relationship(back_populates="accounts")
    ledger: Mapped[Ledger | None] = relationship(back_populates="accounts", lazy="selectin")
    balances: Mapped[list[Balance]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    transactions: Mapped[list[Transaction]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )

    @property
    def iban_masked(self) -> str:
        if len(self.iban) <= 8:
            return self.iban
        return f"{self.iban[:4]}…{self.iban[-4:]}"

    @property
    def display_name(self) -> str:
        return self.name or self.product or self.iban_masked


class Balance(Base):
    """Instantania de saldo, conservada per dibuixar l'evolucio."""

    __tablename__ = "balances"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "balance_type", "reference_date", name="uq_balance_account_type_date"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    balance_type: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[Decimal] = money_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    reference_date: Mapped[date] = mapped_column(Date, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    account: Mapped[Account] = relationship(back_populates="balances")


class SyncRun(Base):
    """Traca de cada sincronitzacio, tambe per controlar els limits de crides."""

    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trigger: Mapped[SyncTrigger] = enum_column(SyncTrigger, nullable=False)
    status: Mapped[SyncStatus] = enum_column(SyncStatus, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accounts_synced: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transactions_inserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transactions_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")

    connection: Mapped[BankConnection] = relationship(back_populates="sync_runs")
