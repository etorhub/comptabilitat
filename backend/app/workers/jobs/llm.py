"""Feina programada: classificacio nocturna amb el model local, espai per espai."""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.db import session_scope
from app.models import Ledger
from app.services.llm_classification import classify_merchants

logger = logging.getLogger(__name__)


def run_llm_classification(limit: int = 50) -> str:
    linies: list[str] = []
    with session_scope() as db:
        for ledger in db.scalars(select(Ledger).where(Ledger.is_active.is_(True))):
            stats = classify_merchants(db, ledger.id, limit=limit)
            linies.append(f"{ledger.name}: {stats}")
    resum = " | ".join(linies)
    logger.info("Classificacio amb model local: %s", resum)
    return resum
