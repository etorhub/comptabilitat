"""Punt d'entrada de l'API."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import settings

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Gestor de comptabilitat personal i familiar",
    docs_url="/api/docs" if settings.debug else None,
    openapi_url="/api/openapi.json" if settings.debug else None,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix="/api")


@app.get("/api/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
