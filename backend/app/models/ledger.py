"""Espais de treball (Personal, Calella, Pardals...).

Cada espai es una comptabilitat estanca: te els seus comptes, el seu pla de
categories, els seus comercos i les seves regles, i nomes hi entra qui hi te
acces. No hi ha cap vista que els barregi.
"""

from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, money_column

if TYPE_CHECKING:
    from app.models.banking import Account
    from app.models.user import LedgerPermission


class Ledger(Base, TimestampMixin):
    __tablename__ = "ledgers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    color: Mapped[str] = mapped_column(String(9), nullable=False, default="#2563eb")
    # Saldo per sota del qual es considera descobert i s'avisa.
    overdraft_threshold: Mapped[Decimal] = money_column(nullable=False, default=Decimal("0.00"))
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # A qui van els avisos d'aquest espai. Buit: als de la configuracio general.
    alert_recipients: Mapped[list[str]] = mapped_column(
        ARRAY(String(255)), nullable=False, default=list
    )

    accounts: Mapped[list[Account]] = relationship(back_populates="ledger")
    permissions: Mapped[list[LedgerPermission]] = relationship(
        back_populates="ledger", cascade="all, delete-orphan"
    )
