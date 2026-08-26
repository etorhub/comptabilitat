"""Feina programada: recurrents, previsio i avisos derivats, espai per espai."""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.db import session_scope
from app.models import Ledger
from app.services.forecast import check_overdrafts
from app.services.recurring import check_missing_occurrences, detect_recurring

logger = logging.getLogger(__name__)


def run_analysis_job() -> str:
    linies: list[str] = []
    with session_scope() as db:
        for ledger in db.scalars(select(Ledger).where(Ledger.is_active.is_(True))):
            stats = detect_recurring(db, ledger.id)
            missing = check_missing_occurrences(db, ledger.id)
            overdrafts = check_overdrafts(db, ledger.id)
            linies.append(
                f"{ledger.name}: {stats}; {missing} rebuts que no han arribat; "
                f"{overdrafts} avisos de descobert"
            )

    resum = " | ".join(linies)
    logger.info("Analisi feta: %s", resum)
    return resum
