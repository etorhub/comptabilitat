"""Connexions bancaries: autoritzacio, retorn del banc i sincronitzacio."""

from __future__ import annotations

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select, update

from app.api.routes.accounts import to_out as account_to_out
from app.config import settings
from app.deps import AdminUser, DbSession
from app.integrations.enablebanking.client import EnableBankingClient, EnableBankingError
from app.models import Account, BankConnection, Ledger, SyncRun, Transaction
from app.models.enums import CategorySource, ConnectionStatus, SyncTrigger
from app.schemas.banking import (
    AccountAssign,
    AccountOut,
    AspspOut,
    AuthorizeRequest,
    AuthorizeResponse,
    ConnectionOut,
    SyncRequest,
    SyncRunOut,
)
from app.schemas.common import Message
from app.services import sync as sync_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["connexions"])


def _to_out(connection: BankConnection) -> ConnectionOut:
    data = ConnectionOut.model_validate(connection)
    data.days_until_expiry = connection.days_until_expiry
    return data


@router.get("/connections", response_model=list[ConnectionOut])
def list_connections(db: DbSession, admin: AdminUser):
    connections = db.scalars(
        select(BankConnection).order_by(BankConnection.created_at.desc())
    ).all()
    return [_to_out(item) for item in connections]


@router.get("/connections/aspsps", response_model=list[AspspOut])
def list_aspsps(db: DbSession, admin: AdminUser, country: str = Query(default="ES")):
    """Bancs disponibles al pais indicat."""
    try:
        with EnableBankingClient() as client:
            entries = client.list_aspsps(country=country.upper())
    except EnableBankingError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return [
        AspspOut(
            name=str(item.get("name", "")),
            country=str(item.get("country", "")),
            logo=item.get("logo"),
            psu_types=list(item.get("psu_types") or []),
        )
        for item in entries
    ]


@router.post("/connections/authorize", response_model=AuthorizeResponse)
def authorize(payload: AuthorizeRequest, db: DbSession, admin: AdminUser):
    """Comenca l'autoritzacio: retorna la URL del banc on ha d'anar l'usuari."""
    try:
        url, connection = sync_service.start_authorization(
            db,
            admin,
            aspsp_name=payload.aspsp_name,
            aspsp_country=payload.aspsp_country,
            psu_type=payload.psu_type,
            connection_id=payload.connection_id,
        )
    except EnableBankingError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    db.commit()
    return AuthorizeResponse(authorization_url=url, connection_id=connection.id)


@router.get("/auth/callback", include_in_schema=False)
def enablebanking_callback(
    db: DbSession,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Retorn del banc despres de l'SCA.

    No demana sessio d'usuari: qui autoritza es el navegador que torna del banc.
    El secret es el parametre `state`, que nomes es valid una vegada.
    """
    base = f"{settings.public_base_url.rstrip('/')}/connexions"

    def redirect(**params: str) -> RedirectResponse:
        return RedirectResponse(f"{base}?{urlencode(params)}", status_code=303)

    if error:
        logger.warning("El banc ha retornat un error d'autoritzacio: %s", error)
        return redirect(estat="error", motiu=error[:200])
    if not code or not state:
        return redirect(estat="error", motiu="Falten parametres al retorn del banc")

    try:
        connection = sync_service.complete_authorization(db, code=code, state=state)
        db.commit()
    except ValueError as exc:
        db.rollback()
        return redirect(estat="error", motiu=str(exc)[:200])
    except EnableBankingError as exc:
        db.commit()  # conserva l'estat d'error desat a la connexio
        return redirect(estat="error", motiu=str(exc)[:200])

    return redirect(estat="ok", connexio=str(connection.id))


@router.post("/connections/{connection_id}/sync", response_model=SyncRunOut)
def sync_connection(connection_id: int, payload: SyncRequest, db: DbSession, admin: AdminUser):
    connection = db.get(BankConnection, connection_id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connexio no trobada")

    sync_service.sync_connection(
        db, connection, trigger=SyncTrigger.MANUAL, days_back=payload.days_back
    )
    db.commit()
    run = db.scalar(
        select(SyncRun)
        .where(SyncRun.connection_id == connection_id)
        .order_by(SyncRun.started_at.desc())
        .limit(1)
    )
    return run


@router.get("/connections/{connection_id}/syncs", response_model=list[SyncRunOut])
def list_sync_runs(connection_id: int, db: DbSession, admin: AdminUser, limit: int = 20):
    runs = db.scalars(
        select(SyncRun)
        .where(SyncRun.connection_id == connection_id)
        .order_by(SyncRun.started_at.desc())
        .limit(limit)
    ).all()
    return list(runs)


@router.delete("/connections/{connection_id}", response_model=Message)
def revoke_connection(
    connection_id: int,
    db: DbSession,
    admin: AdminUser,
    purge: bool = Query(
        default=False,
        description="Esborra tambe els comptes i tots els seus moviments importats",
    ),
):
    """Revoca la connexio al banc.

    Per defecte nomes es tanca la sessio: els comptes i l'historic importat es
    conserven, perque un cop passada la finestra del banc son l'unica copia.
    Amb `purge=true` s'esborra tot, cosa que no te marxa enrere.
    """
    connection = db.get(BankConnection, connection_id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connexio no trobada")

    if connection.eb_session_id:
        try:
            with EnableBankingClient() as client:
                client.delete_session(connection.eb_session_id)
        except EnableBankingError as exc:
            # Si la sessio ja no existeix al banc, no es motiu per aturar-se.
            logger.warning("No s'ha pogut tancar la sessio al banc: %s", exc)

    if purge:
        db.delete(connection)
        db.commit()
        return Message(message="Connexio, comptes i moviments esborrats")

    connection.status = ConnectionStatus.REVOKED
    connection.eb_session_id = None
    connection.eb_auth_state = None
    for account in connection.accounts:
        account.is_active = False
    db.commit()
    return Message(message="Connexio revocada. Els moviments importats es conserven.")


@router.patch("/connections/accounts/{account_id}", response_model=AccountOut)
def assign_account(account_id: int, payload: AccountAssign, db: DbSession, admin: AdminUser):
    """Assigna un compte a un espai (o el treu).

    Moure un compte d'espai arrossega tot el seu historic, i les categories, els
    comercos i les regles son de cada espai: per tant, les classificacions
    anteriors deixen de ser valides i els moviments tornen a la cua de revisio
    perque el nou espai els torni a classificar amb els seus criteris.
    """
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte no trobat")

    nou_espai: Ledger | None = None
    if payload.ledger_id is not None:
        nou_espai = db.get(Ledger, payload.ledger_id)
        if nou_espai is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Espai no trobat")

    if payload.ledger_id != account.ledger_id:
        account.ledger_id = payload.ledger_id
        db.execute(
            update(Transaction)
            .where(Transaction.account_id == account.id)
            .values(
                ledger_id=payload.ledger_id,
                merchant_id=None,
                category_id=None,
                category_source=CategorySource.NONE,
                category_confidence=None,
                applied_rule_id=None,
                transfer_group_id=None,
                needs_review=payload.ledger_id is not None,
            )
        )
        db.flush()
        if nou_espai is not None:
            _reclassifica(db, account, nou_espai)

    db.commit()
    return account_to_out(db, account)


def _reclassifica(db: DbSession, account: Account, ledger: Ledger) -> None:
    """Torna a derivar comerc i categoria dels moviments amb els criteris del nou espai."""
    from app.services.classification import classify_transaction
    from app.services.merchants import get_or_create_merchant
    from app.services.rules import active_rules

    rules = active_rules(db, ledger.id)
    for transaction in db.scalars(select(Transaction).where(Transaction.account_id == account.id)):
        merchant = get_or_create_merchant(
            db,
            ledger.id,
            transaction.normalized_description,
            seen_on=transaction.booking_date,
        )
        if merchant is not None:
            transaction.merchant_id = merchant.id
        classify_transaction(db, transaction, rules)
    db.flush()


@router.get("/connections/accounts/unassigned", response_model=list[AccountOut])
def unassigned_accounts(db: DbSession, admin: AdminUser):
    """Comptes que encara no s'han assignat a cap espai."""
    accounts = db.scalars(select(Account).where(Account.ledger_id.is_(None))).all()
    return [account_to_out(db, account) for account in accounts]
