"""Esquemes de connexions bancaries, comptes i sincronitzacions."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import ConnectionStatus, SyncStatus, SyncTrigger
from app.schemas.common import ORMModel


class AspspOut(BaseModel):
    name: str
    country: str
    logo: str | None = None
    psu_types: list[str] = []


class AccountOut(ORMModel):
    id: int
    connection_id: int
    ledger_id: int | None
    name: str
    product: str
    iban_masked: str
    currency: str
    cash_account_type: str
    is_active: bool
    history_start_date: date | None
    last_booked_date: date | None
    current_balance: Decimal | None = None


class AccountUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class AccountAssign(BaseModel):
    """Assignacio d'un compte a un espai. Nul el treu de tots."""

    ledger_id: int | None = None


class ConnectionOut(ORMModel):
    id: int
    name: str
    aspsp_name: str
    aspsp_country: str
    status: ConnectionStatus
    valid_until: datetime | None
    last_sync_at: datetime | None
    last_error: str
    days_until_expiry: int | None = None
    accounts: list[AccountOut] = []


class AuthorizeRequest(BaseModel):
    aspsp_name: str | None = None
    aspsp_country: str | None = None
    psu_type: str = "personal"
    # Permet renovar el consentiment d'una connexio existent conservant els comptes.
    connection_id: int | None = None


class AuthorizeResponse(BaseModel):
    authorization_url: str
    connection_id: int


class SyncRunOut(ORMModel):
    id: int
    connection_id: int
    trigger: SyncTrigger
    status: SyncStatus
    started_at: datetime
    finished_at: datetime | None
    accounts_synced: int
    transactions_inserted: int
    transactions_updated: int
    error: str


class SyncRequest(BaseModel):
    # Nombre de dies enrere a rellegir; per defecte, incremental.
    days_back: int | None = Field(default=None, ge=1, le=1000)


class BalancePoint(BaseModel):
    reference_date: date
    amount: Decimal
