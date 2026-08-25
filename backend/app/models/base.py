"""Base declarativa, mixins i tipus compartits pels models."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum as SAEnum, MetaData, Numeric, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Convencio de noms perque Alembic pugui generar migracions estables.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def money_column(**kwargs: Any) -> Mapped[Any]:
    """Columna d'import: sempre NUMERIC(14,2), mai coma flotant."""
    return mapped_column(Numeric(14, 2), **kwargs)


def enum_column(enum_cls: type[enum.Enum], **kwargs: Any) -> Mapped[Any]:
    """Enum desat com a VARCHAR amb CHECK, per facilitar les migracions."""
    return mapped_column(
        SAEnum(
            enum_cls,
            native_enum=False,
            length=32,
            values_callable=lambda e: [item.value for item in e],
        ),
        **kwargs,
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
