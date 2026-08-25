"""Utilitats de temps: sempre amb zona horaria explicita."""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.config import settings

LOCAL_TZ = ZoneInfo(settings.timezone)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def today_local() -> date:
    return datetime.now(LOCAL_TZ).date()


def to_local(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(LOCAL_TZ)
