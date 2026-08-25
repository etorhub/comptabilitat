"""Registre de totes les rutes de l'API."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import auth, ledgers, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(ledgers.router)
api_router.include_router(users.router)
