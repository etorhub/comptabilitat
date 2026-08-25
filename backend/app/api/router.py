"""Registre de totes les rutes de l'API."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import accounts, auth, connections, ledgers, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(ledgers.router)
api_router.include_router(users.router)
api_router.include_router(connections.router)
api_router.include_router(accounts.router)
