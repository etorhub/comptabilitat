"""Creacio d'avisos amb deduplicacio."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert
from app.models.enums import AlertSeverity, AlertStatus, AlertType


def create_alert(
    db: Session,
    *,
    type: AlertType,
    dedup_key: str,
    title: str,
    body: str = "",
    ledger_id: int | None = None,
    severity: AlertSeverity = AlertSeverity.WARNING,
    payload: dict[str, Any] | None = None,
) -> Alert | None:
    """Crea l'avis si no n'hi ha cap de viu amb la mateixa clau.

    La clau ha d'incloure el periode (per exemple el mes o la data prevista)
    perque el mateix problema no generi un avis nou cada dia.
    """
    existing = db.scalar(select(Alert).where(Alert.dedup_key == dedup_key))
    if existing is not None:
        # Si l'usuari ja el va descartar, no el ressuscitem.
        return None

    alert = Alert(
        ledger_id=ledger_id,
        type=type,
        severity=severity,
        status=AlertStatus.NEW,
        dedup_key=dedup_key[:200],
        title=title[:250],
        body=body,
        payload=payload or {},
    )
    db.add(alert)
    db.flush()
    return alert
