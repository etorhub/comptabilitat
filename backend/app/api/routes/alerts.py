"""Avisos d'un espai."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.deps import DbSession, Workspace
from app.models import Alert
from app.models.enums import AlertStatus
from app.schemas.analytics import AlertOut
from app.schemas.common import Message

router = APIRouter(prefix="/alerts", tags=["avisos"])


def _get_in_workspace(db: DbSession, workspace, alert_id: int) -> Alert:
    alert = db.get(Alert, alert_id)
    if alert is None or alert.ledger_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Avis no trobat")
    return alert


@router.get("", response_model=list[AlertOut])
def list_alerts(
    db: DbSession,
    workspace: Workspace,
    include_dismissed: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
):
    query = select(Alert).where(Alert.ledger_id == workspace.id)
    if not include_dismissed:
        query = query.where(Alert.status != AlertStatus.DISMISSED)

    alerts = db.scalars(query.order_by(Alert.created_at.desc()).limit(limit)).all()
    return [AlertOut.model_validate(alert) for alert in alerts]


@router.post("/{alert_id}/read", response_model=AlertOut)
def mark_read(alert_id: int, db: DbSession, workspace: Workspace):
    alert = _get_in_workspace(db, workspace, alert_id)
    alert.status = AlertStatus.READ
    db.commit()
    return AlertOut.model_validate(alert)


@router.post("/{alert_id}/dismiss", response_model=Message)
def dismiss(alert_id: int, db: DbSession, workspace: Workspace):
    """Descarta l'avis. No en tornara a apareixer cap d'igual."""
    alert = _get_in_workspace(db, workspace, alert_id)
    alert.status = AlertStatus.DISMISSED
    db.commit()
    return Message(message="Avis descartat")
