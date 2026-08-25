"""Feina programada: sincronitzacio diaria amb els bancs."""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.db import session_scope
from app.models import BankConnection
from app.models.enums import ConnectionStatus, SyncTrigger
from app.services import sync as sync_service

logger = logging.getLogger(__name__)


def run_sync_job(connection_id: int | None = None, days_back: int | None = None) -> str:
    """Sincronitza les connexions actives i revisa els consentiments."""
    with session_scope() as db:
        query = select(BankConnection).where(
            BankConnection.status == ConnectionStatus.ACTIVE,
            BankConnection.eb_session_id.is_not(None),
        )
        if connection_id is not None:
            query = select(BankConnection).where(BankConnection.id == connection_id)

        connections = list(db.scalars(query))
        if not connections:
            logger.info("No hi ha cap connexio activa per sincronitzar")
            return "Cap connexio activa"

        lines: list[str] = []
        trigger = SyncTrigger.MANUAL if connection_id else SyncTrigger.SCHEDULED
        for connection in connections:
            result = sync_service.sync_connection(
                db, connection, trigger=trigger, days_back=days_back
            )
            lines.append(str(result))

        expiring = sync_service.check_consents(db)
        if expiring:
            lines.append(f"{len(expiring)} consentiments requereixen atencio")

    return "\n".join(lines)
