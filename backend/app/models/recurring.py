"""Series recurrents (rebuts, subscripcions) i les seves aparicions."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_column, money_column
from app.models.enums import Cadence, SeriesStatus
from app.models.transaction import Category, Merchant


class RecurringSeries(Base, TimestampMixin):
    __tablename__ = "recurring_series"
    __table_args__ = (
        UniqueConstraint("ledger_id", "signature", name="uq_recurring_ledger_signature"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ledger_id: Mapped[int] = mapped_column(
        ForeignKey("ledgers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Clau estable de la serie: comerc normalitzat (o descripcio) + signe de l'import.
    signature: Mapped[str] = mapped_column(String(220), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    merchant_id: Mapped[int | None] = mapped_column(
        ForeignKey("merchants.id", ondelete="SET NULL")
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    cadence: Mapped[Cadence] = enum_column(Cadence, nullable=False)
    expected_amount: Mapped[Decimal] = money_column(nullable=False)
    amount_tolerance: Mapped[Decimal] = money_column(nullable=False, default=Decimal("0.00"))
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    occurrences_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_seen_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_seen_date: Mapped[date] = mapped_column(Date, nullable=False)
    next_expected_date: Mapped[date | None] = mapped_column(Date, index=True)
    is_subscription: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[SeriesStatus] = enum_column(
        SeriesStatus, nullable=False, default=SeriesStatus.ACTIVE
    )
    # Permet excloure una serie de la previsio sense esborrar-la.
    include_in_forecast: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    merchant: Mapped[Merchant | None] = relationship(lazy="selectin")
    category: Mapped[Category | None] = relationship(lazy="selectin")
    occurrences: Mapped[list["RecurringOccurrence"]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )

    @property
    def monthly_cost(self) -> Decimal:
        """Cost normalitzat a un mes, per comparar subscripcions entre elles."""
        return (self.expected_amount * Decimal(30)) / Decimal(self.interval_days or 30)


class RecurringOccurrence(Base):
    __tablename__ = "recurring_occurrences"
    __table_args__ = (
        UniqueConstraint("series_id", "transaction_id", name="uq_occurrence_series_transaction"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("recurring_series.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = money_column(nullable=False)

    series: Mapped[RecurringSeries] = relationship(back_populates="occurrences")
