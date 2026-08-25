"""Feina programada: recurrents, previsio i avisos derivats."""

from __future__ import annotations

import logging

from app.db import session_scope
from app.services.forecast import check_overdrafts
from app.services.recurring import check_missing_occurrences, detect_recurring

logger = logging.getLogger(__name__)


def run_analysis_job() -> str:
    with session_scope() as db:
        stats = detect_recurring(db)
        missing = check_missing_occurrences(db)
        overdrafts = check_overdrafts(db)

    summary = f"{stats}; {missing} rebuts que no han arribat; {overdrafts} avisos de descobert"
    logger.info("Analisi feta: %s", summary)
    return summary
