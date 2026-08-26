"""Memoria de comercos de cada espai.

Dins d'un espai, un comerc es classifica una sola vegada. Entre espais no es
comparteix res: el mateix Mercadona es un comerc diferent a Personal i a
Calella, perque cadascun te els seus usuaris i el seu pla de categories.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Merchant


def get_or_create_merchant(
    db: Session,
    ledger_id: int,
    normalized_name: str,
    display: str = "",
    seen_on: date | None = None,
) -> Merchant | None:
    """Retorna el comerc d'aquest espai amb aquest nom, creant-lo si cal."""
    normalized_name = (normalized_name or "").strip()
    if not normalized_name or ledger_id is None:
        return None

    merchant = db.scalar(
        select(Merchant).where(
            Merchant.ledger_id == ledger_id,
            Merchant.normalized_name == normalized_name,
        )
    )
    if merchant is None:
        merchant = Merchant(
            ledger_id=ledger_id,
            normalized_name=normalized_name[:200],
            display_name=(display or normalized_name)[:200],
        )
        db.add(merchant)
        db.flush()

    merchant.transaction_count += 1
    if seen_on and (merchant.last_seen_at is None or seen_on > merchant.last_seen_at):
        merchant.last_seen_at = seen_on
    return merchant
