"""Feina programada: classificacio nocturna amb el model local."""

from __future__ import annotations

import logging

from app.db import session_scope
from app.services.llm_classification import classify_merchants

logger = logging.getLogger(__name__)


def run_llm_classification(limit: int = 50) -> str:
    with session_scope() as db:
        stats = classify_merchants(db, limit=limit)
    logger.info("Classificacio amb model local: %s", stats)
    return str(stats)
