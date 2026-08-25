"""Avisos generats pel sistema (descoberts, consentiments, recurrents)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, enum_column
from app.models.enums import AlertSeverity, AlertStatus, AlertType


class Alert(Base, TimestampMixin):
    __tablename__ = "alerts"
    __table_args__ = (
        # Evita repetir el mateix avis dia rere dia: la clau inclou el periode.
        UniqueConstraint("dedup_key", name="uq_alert_dedup_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ledger_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledgers.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[AlertType] = enum_column(AlertType, nullable=False, index=True)
    severity: Mapped[AlertSeverity] = enum_column(
        AlertSeverity, nullable=False, default=AlertSeverity.WARNING
    )
    status: Mapped[AlertStatus] = enum_column(
        AlertStatus, nullable=False, default=AlertStatus.NEW, index=True
    )
    dedup_key: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
