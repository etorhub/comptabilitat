"""Registre de totes les rutes de l'API."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    accounts,
    alerts,
    analytics,
    auth,
    categories,
    connections,
    ledgers,
    merchants,
    recurring,
    rules,
    transactions,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(ledgers.router)
api_router.include_router(users.router)
api_router.include_router(connections.router)
api_router.include_router(accounts.router)
api_router.include_router(categories.router)
api_router.include_router(merchants.router)
api_router.include_router(transactions.router)
api_router.include_router(rules.router)
api_router.include_router(recurring.router)
api_router.include_router(alerts.router)
api_router.include_router(analytics.router)
