"""Usuaris, sessions i permisos per llibre."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_column
from app.models.enums import LedgerRole

if TYPE_CHECKING:
    from app.models.ledger import Ledger


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    permissions: Mapped[list["LedgerPermission"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class LedgerPermission(Base, TimestampMixin):
    """Acces d'un usuari a un llibre concret."""

    __tablename__ = "user_ledger_permissions"
    __table_args__ = (UniqueConstraint("user_id", "ledger_id", name="uq_user_ledger"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ledger_id: Mapped[int] = mapped_column(
        ForeignKey("ledgers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[LedgerRole] = enum_column(LedgerRole, nullable=False, default=LedgerRole.VIEWER)

    user: Mapped[User] = relationship(back_populates="permissions")
    ledger: Mapped["Ledger"] = relationship(back_populates="permissions", lazy="selectin")


class UserSession(Base):
    """Sessio de navegador. Es desa nomes el hash del testimoni."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user_agent: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    user: Mapped[User] = relationship(back_populates="sessions")
