"""Feina programada: enviament dels avisos per correu."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_local, utcnow
from app.db import session_scope
from app.models import Alert
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


def notify_pending(db: Session, only_critical: bool = False) -> str:
    query = select(Alert).where(Alert.notified_at.is_(None), Alert.status != AlertStatus.DISMISSED)
    if only_critical:
        query = query.where(Alert.severity == AlertSeverity.CRITICAL)
    alerts = list(db.scalars(query.order_by(Alert.severity, Alert.created_at)))

    if not alerts:
        return "Cap avis pendent d'enviar"

    if only_critical:
        title = "Avis urgent de la comptabilitat"
        subtitle = "Hi ha una cosa que necessita atencio ara."
    else:
        title = "Resum d'avisos"
        subtitle = f"Avisos nous del {today_local():%d/%m/%Y}."

    html, text = render_digest(alerts, title, subtitle)
    subject = f"{title}: {alerts[0].title}" if len(alerts) == 1 else f"{title} ({len(alerts)})"

    if not send_email(subject, html, text):
        return f"{len(alerts)} avisos pendents: el correu no esta configurat o ha fallat"

    sent_at = utcnow()
    for alert in alerts:
        alert.notified_at = sent_at
    db.flush()

    return f"{len(alerts)} avisos enviats per correu"
