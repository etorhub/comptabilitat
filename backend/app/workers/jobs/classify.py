"""Feina programada: classificacio dels moviments pendents."""

from __future__ import annotations

import logging

from app.db import session_scope
from app.services.classification import classify_pending
from app.services.transfers import detect_transfers

logger = logging.getLogger(__name__)


def run_classification_job(use_llm: bool = True) -> str:
    """Aparella traspassos, aplica regles i comercos i, si cal, crida el model."""
    with session_scope() as db:
        transfers = detect_transfers(db)
        stats = classify_pending(db)

    lines = [f"{transfers} traspassos aparellats", str(stats)]

    if use_llm:
        from app.workers.jobs.llm import run_llm_classification

        lines.append(run_llm_classification())

    return "; ".join(lines)
