"""Configuracio de l'aplicacio, llegida de variables d'entorn."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import base64

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- General ---
    app_name: str = "Comptabilitat"
    environment: str = "development"
    debug: bool = False
    timezone: str = "Europe/Madrid"
    # URL publica de l'aplicacio (la del tunel de Cloudflare en produccio).
    public_base_url: str = "http://localhost:8000"

    # --- Base de dades ---
    database_url: str = "postgresql+psycopg://comptabilitat:comptabilitat@db:5432/comptabilitat"

    # --- Sessions / seguretat ---
    secret_key: str = "canvia-aquesta-clau-en-produccio"
    session_cookie_name: str = "comptabilitat_session"
    session_max_age_days: int = 14
    cookie_secure: bool = True
    cors_origins: list[str] = Field(default_factory=list)

    # --- Enable Banking ---
    eb_api_origin: str = "https://api.enablebanking.com"
    eb_application_id: str = ""
    eb_private_key_path: Path = Path("/run/secrets/eb_private_key")
    # Alternativa al fitxer: la clau en PEM directament (util en desenvolupament).
    eb_private_key: str = ""
    # Variante en base64 per desplegar via Portainer (una sola linia).
    eb_private_key_b64: str = ""
    eb_default_aspsp_name: str = "Santander"
    eb_default_aspsp_country: str = "ES"
    # Dies de validesa que demanem del consentiment (el maxim habitual sota PSD2 es 90).
    eb_consent_days: int = 90
    # Mesos d'historic que intentem baixar la primera vegada.
    eb_initial_history_months: int = 24
    # Marge de dies que tornem a demanar a cada sync per capturar reprocessaments.
    eb_resync_overlap_days: int = 7

    # --- Ollama ---
    ollama_enabled: bool = False
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "qwen3:4b"
    ollama_timeout_seconds: int = 180
    # Confianca minima perque un suggeriment s'apliqui (per sota queda sense classificar).
    ollama_min_confidence: float = 0.55

    # --- Correu ---
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True
    alert_recipients: list[str] = Field(default_factory=list)

    # --- Planificador ---
    scheduler_enabled: bool = True
    sync_cron_hour: int = 6
    sync_cron_minute: int = 30
    classify_cron_hour: int = 3
    analysis_cron_hour: int = 4
    notify_cron_hour: int = 8

    # --- Previsio ---
    forecast_horizon_days: int = 90

    @field_validator("cors_origins", "alert_recipients", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def eb_redirect_url(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/api/auth/callback"

    @property
    def resolved_eb_private_key(self) -> str:
        if self.eb_private_key:
            return self.eb_private_key
        if self.eb_private_key_b64:
            return base64.b64decode(self.eb_private_key_b64).decode()
        if self.eb_private_key_path.exists():
            return self.eb_private_key_path.read_text()
        return ""

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from and self.alert_recipients)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
