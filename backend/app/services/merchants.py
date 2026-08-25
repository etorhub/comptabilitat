"""Memoria de comercos: cada nom normalitzat es classifica una sola vegada."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Merchant


def get_or_create_merchant(
    db: Session, normalized_name: str, display: str = "", seen_on: date | None = None
) -> Merchant | None:
    """Retorna el comerc amb aquest nom normalitzat, creant-lo si cal."""
    normalized_name = (normalized_name or "").strip()
    if not normalized_name:
        return None

    merchant = db.scalar(select(Merchant).where(Merchant.normalized_name == normalized_name))
    if merchant is None:
        merchant = Merchant(
            normalized_name=normalized_name[:200],
            display_name=(display or normalized_name)[:200],
        )
        db.add(merchant)
        db.flush()

    merchant.transaction_count += 1
    if seen_on and (merchant.last_seen_at is None or seen_on > merchant.last_seen_at):
        merchant.last_seen_at = seen_on
    return merchant
