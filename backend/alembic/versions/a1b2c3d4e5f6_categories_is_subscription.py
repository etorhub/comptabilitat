"""categories is_subscription

Revision ID: a1b2c3d4e5f6
Revises: 717934ccafc1
Create Date: 2026-09-01 13:05:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "717934ccafc1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("is_subscription", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("categories", "is_subscription")
