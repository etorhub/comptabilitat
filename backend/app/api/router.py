"""Registre de totes les rutes de l'API.

Les dades pengen sempre d'un espai (`/api/workspaces/{codi}/...`): no hi ha cap
ruta que en barregi mes d'un. Nomes queden fora de l'espai l'autenticacio, el
llistat d'espais, la gestio d'usuaris i les connexions bancaries, que son
transversals per naturalesa.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    accounts,
    alerts,
    analytics,
    auth,
    categories,
    connections,
    exports,
    merchants,
    recurring,
    rules,
    transactions,
    users,
    workspaces,
)

# --- Rutes transversals ---
api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(connections.router)
api_router.include_router(workspaces.router)

# --- Rutes de dins d'un espai ---
workspace_router = APIRouter(prefix="/workspaces/{codi}")
workspace_router.include_router(accounts.router)
workspace_router.include_router(categories.router)
workspace_router.include_router(merchants.router)
workspace_router.include_router(transactions.router)
workspace_router.include_router(rules.router)
workspace_router.include_router(recurring.router)
workspace_router.include_router(alerts.router)
workspace_router.include_router(analytics.router)
workspace_router.include_router(exports.router)

api_router.include_router(workspace_router)
