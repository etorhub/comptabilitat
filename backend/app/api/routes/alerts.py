"""Avisos."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.deps import CurrentUser, DbSession, resolve_ledger_scope
from app.models import Alert
from app.models.enums import AlertStatus
from app.schemas.analytics import AlertOut
from app.schemas.common import Message

router = APIRouter(prefix="/alerts", tags=["avisos"])


@router.get("", response_model=list[AlertOut])
def list_alerts(
    db: DbSession,
    user: CurrentUser,
    ledger_ids: list[int] | None = Query(default=None),
    include_dismissed: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
):
    scope = resolve_ledger_scope(db, user, ledger_ids)
    # Els avisos sense llibre (connexions, sincronitzacio) els veu tothom.
    condition = Alert.ledger_id.is_(None)
    if scope:
        condition = or_(condition, Alert.ledger_id.in_(scope))

    query = select(Alert).where(condition)
    if not include_dismissed:
        query = query.where(Alert.status != AlertStatus.DISMISSED)

    alerts = db.scalars(query.order_by(Alert.created_at.desc()).limit(limit)).all()
    return [AlertOut.model_validate(alert) for alert in alerts]


def _get_visible(db: DbSession, user, alert_id: int) -> Alert:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Avis no trobat")
    if alert.ledger_id is not None and alert.ledger_id not in resolve_ledger_scope(db, user, None):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sense acces a aquest avis")
    return alert


@router.post("/{alert_id}/read", response_model=AlertOut)
def mark_read(alert_id: int, db: DbSession, user: CurrentUser):
    alert = _get_visible(db, user, alert_id)
    alert.status = AlertStatus.READ
    db.commit()
    return AlertOut.model_validate(alert)


@router.post("/{alert_id}/dismiss", response_model=Message)
def dismiss(alert_id: int, db: DbSession, user: CurrentUser):
    """Descarta l'avis. No en tornara a apareixer cap d'igual."""
    alert = _get_visible(db, user, alert_id)
    alert.status = AlertStatus.DISMISSED
    db.commit()
    return Message(message="Avis descartat")
