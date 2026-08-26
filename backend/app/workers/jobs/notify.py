"""Feina programada: enviament dels avisos per correu.

Cada espai te els seus destinataris: l'avis d'un descobert a Calella nomes va
a qui li pertoca. Els avisos que no son de cap espai (connexions, sincronitza-
cions) van als destinataris generals de la configuracio.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.time import today_local, utcnow
from app.db import session_scope
from app.models import Alert, Ledger
from app.models.enums import AlertSeverity, AlertStatus
from app.notifications.email import render_digest, send_email

logger = logging.getLogger(__name__)


def run_notification_job(only_critical: bool = False, db: Session | None = None) -> str:
    """Envia els avisos encara no notificats.

    Amb `only_critical` nomes surten els urgents, perque es pugui cridar cada
    hora sense omplir la bustia; la resta van al resum diari.
    """
    if db is not None:
        return notify_pending(db, only_critical)
    with session_scope() as session:
        return notify_pending(session, only_critical)


def recipients_for(ledger: Ledger | None) -> list[str]:
    """A qui van els avisos d'aquest espai."""
    if ledger is not None and ledger.alert_recipients:
        return list(ledger.alert_recipients)
    return list(settings.alert_recipients)


def notify_pending(db: Session, only_critical: bool = False) -> str:
    query = select(Alert).where(Alert.notified_at.is_(None), Alert.status != AlertStatus.DISMISSED)
    if only_critical:
        query = query.where(Alert.severity == AlertSeverity.CRITICAL)
    alerts = list(db.scalars(query.order_by(Alert.severity, Alert.created_at)))

    if not alerts:
        return "Cap avis pendent d'enviar"

    per_espai: dict[int | None, list[Alert]] = defaultdict(list)
    for alert in alerts:
        per_espai[alert.ledger_id].append(alert)

    enviats = 0
    pendents = 0
    for ledger_id, del_espai in per_espai.items():
        ledger = db.get(Ledger, ledger_id) if ledger_id is not None else None
        destinataris = recipients_for(ledger)
        if not destinataris:
            logger.info(
                "Sense destinataris per a %s: %s avisos queden pendents",
                ledger.name if ledger else "avisos generals",
                len(del_espai),
            )
            pendents += len(del_espai)
            continue

        if only_critical:
            title = "Avis urgent de la comptabilitat"
            subtitle = "Hi ha una cosa que necessita atencio ara."
        else:
            title = "Resum d'avisos"
            subtitle = f"Avisos nous del {today_local():%d/%m/%Y}."
        if ledger is not None:
            subtitle = f"{ledger.name} · {subtitle}"

        html, text = render_digest(del_espai, title, subtitle)
        nom = f"{title} · {ledger.name}" if ledger else title
        subject = (
            f"{nom}: {del_espai[0].title}" if len(del_espai) == 1 else f"{nom} ({len(del_espai)})"
        )

        if not send_email(subject, html, text, recipients=destinataris):
            pendents += len(del_espai)
            continue

        sent_at = utcnow()
        for alert in del_espai:
            alert.notified_at = sent_at
        enviats += len(del_espai)

    db.flush()

    if enviats and pendents:
        return f"{enviats} avisos enviats; {pendents} pendents (sense destinatari o error)"
    if enviats:
        return f"{enviats} avisos enviats per correu"
    return f"{pendents} avisos pendents: no hi ha destinataris o el correu ha fallat"
