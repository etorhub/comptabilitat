"""Feina programada: classificacio dels moviments pendents, espai per espai."""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.db import session_scope
from app.models import Ledger
from app.services.classification import classify_pending
from app.services.transfers import detect_transfers

logger = logging.getLogger(__name__)


def run_classification_job(use_llm: bool = True) -> str:
    """Aparella traspassos, aplica regles i comercos i, si cal, crida el model.

    Cada espai es processa per separat: les regles i els comercos d'un no
    toquen els dels altres.
    """
    linies: list[str] = []
    with session_scope() as db:
        for ledger in db.scalars(select(Ledger).where(Ledger.is_active.is_(True))):
            transfers = detect_transfers(db, ledger.id)
            stats = classify_pending(db, ledger.id)
            linies.append(f"{ledger.name}: {transfers} traspassos, {stats}")

    if use_llm:
        from app.workers.jobs.llm import run_llm_classification

        linies.append(run_llm_classification())

    return " | ".join(linies)
