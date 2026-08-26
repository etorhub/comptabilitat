"""Sincronitzacio amb el banc: autoritzacio, comptes, saldos i moviments."""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.time import today_local, utcnow
from app.integrations.enablebanking.client import (
    DateRangeError,
    EnableBankingClient,
    EnableBankingError,
    SessionExpiredError,
)
from app.integrations.enablebanking.parsing import (
    ParsedTransaction,
    parse_account,
    parse_balance,
    parse_transaction,
)
from app.models import Account, Balance, BankConnection, SyncRun, Transaction, User
from app.models.enums import (
    AlertSeverity,
    AlertType,
    ConnectionStatus,
    SyncStatus,
    SyncTrigger,
    TransactionStatus,
)
from app.services.alerts import create_alert
from app.services.classification import classify_transaction
from app.services.merchants import get_or_create_merchant
from app.services.normalization import normalize_description
from app.services.rules import active_rules

logger = logging.getLogger(__name__)

# Marge en dies per aparellar un moviment pendent amb el seu apunt definitiu.
PENDING_MATCH_DAYS = 5
# Finestres alternatives (en mesos) quan el banc rebutja el periode demanat.
FALLBACK_WINDOWS_MONTHS = [24, 12, 6, 3, 1]


@dataclass
class AccountSyncResult:
    account_id: int
    inserted: int = 0
    updated: int = 0
    removed: int = 0
    error: str = ""


@dataclass
class SyncResult:
    connection_id: int
    accounts: list[AccountSyncResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def inserted(self) -> int:
        return sum(item.inserted for item in self.accounts)

    @property
    def updated(self) -> int:
        return sum(item.updated for item in self.accounts)

    def __str__(self) -> str:
        return (
            f"connexio {self.connection_id}: {len(self.accounts)} comptes, "
            f"{self.inserted} moviments nous, {self.updated} actualitzats"
            + (f", {len(self.errors)} errors" if self.errors else "")
        )


# --- Autoritzacio ---------------------------------------------------------


def start_authorization(
    db: Session,
    user: User | None = None,
    *,
    aspsp_name: str | None = None,
    aspsp_country: str | None = None,
    psu_type: str = "personal",
    connection_id: int | None = None,
    client: EnableBankingClient | None = None,
) -> tuple[str, BankConnection]:
    """Inicia l'autoritzacio al banc i retorna la URL on ha d'anar l'usuari."""
    name = aspsp_name or settings.eb_default_aspsp_name
    country = (aspsp_country or settings.eb_default_aspsp_country).upper()

    if connection_id is not None:
        # Renovacio del consentiment: es conserva la connexio i els seus comptes.
        connection = db.get(BankConnection, connection_id)
        if connection is None:
            raise ValueError("Connexio no trobada")
        name, country = connection.aspsp_name, connection.aspsp_country
        psu_type = connection.psu_type
    else:
        connection = BankConnection(
            name=name,
            aspsp_name=name,
            aspsp_country=country,
            psu_type=psu_type,
            status=ConnectionStatus.PENDING,
            created_by_id=user.id if user else None,
        )
        db.add(connection)

    state = secrets.token_urlsafe(32)
    connection.eb_auth_state = state
    db.flush()

    owned_client = client is None
    client = client or EnableBankingClient()
    try:
        payload = client.start_authorization(
            aspsp_name=name,
            aspsp_country=country,
            redirect_url=settings.eb_redirect_url,
            state=state,
            psu_type=psu_type,
        )
    finally:
        if owned_client:
            client.close()

    url = payload.get("url")
    if not url:
        raise EnableBankingError("El banc no ha retornat cap URL d'autoritzacio")
    db.flush()
    return str(url), connection


def complete_authorization(
    db: Session, *, code: str, state: str, client: EnableBankingClient | None = None
) -> BankConnection:
    """Bescanvia el codi del retorn del banc i desa la sessio i els comptes."""
    connection = db.scalar(select(BankConnection).where(BankConnection.eb_auth_state == state))
    if connection is None:
        raise ValueError("Estat d'autoritzacio desconegut o ja utilitzat")

    owned_client = client is None
    client = client or EnableBankingClient()
    try:
        payload = client.create_session(code)
    except EnableBankingError as exc:
        connection.status = ConnectionStatus.ERROR
        connection.last_error = str(exc)
        db.flush()
        raise
    finally:
        if owned_client:
            client.close()

    connection.eb_session_id = str(payload.get("session_id") or "")
    connection.status = ConnectionStatus.ACTIVE
    connection.last_error = ""
    connection.eb_auth_state = None

    access = payload.get("access") or {}
    if valid_until := access.get("valid_until"):
        connection.valid_until = _parse_datetime(valid_until)

    aspsp = payload.get("aspsp") or {}
    if aspsp.get("name"):
        connection.aspsp_name = str(aspsp["name"])
    if aspsp.get("country"):
        connection.aspsp_country = str(aspsp["country"])

    for raw_account in payload.get("accounts") or []:
        _upsert_account(db, connection, raw_account)

    db.flush()
    return connection


def _upsert_account(db: Session, connection: BankConnection, raw_account: dict) -> Account | None:
    data = parse_account(raw_account)
    if not data["eb_account_uid"]:
        return None

    account = db.scalar(select(Account).where(Account.eb_account_uid == data["eb_account_uid"]))
    if account is None:
        account = Account(connection_id=connection.id, **data)
        db.add(account)
    else:
        # En renovar el consentiment el compte torna amb el mateix uid: es
        # reaprofita la fila per no perdre ni els moviments ni el llibre assignat.
        account.connection_id = connection.id
        account.is_active = True
        for key, value in data.items():
            if key != "eb_account_uid" and value:
                setattr(account, key, value)
    db.flush()
    return account


def _parse_datetime(value: str) -> datetime | None:
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


# --- Sincronitzacio -------------------------------------------------------


def _initial_date_from(months: int) -> date:
    return today_local() - relativedelta(months=months)


def _date_from_for(account: Account, days_back: int | None) -> date:
    if days_back is not None:
        return today_local() - timedelta(days=days_back)
    if account.last_booked_date is not None:
        return account.last_booked_date - timedelta(days=settings.eb_resync_overlap_days)
    return _initial_date_from(settings.eb_initial_history_months)


def _fetch_transactions(
    client: EnableBankingClient, account: Account, date_from: date
) -> tuple[list[ParsedTransaction], date]:
    """Baixa els moviments, reduint la finestra si el banc la rebutja."""
    windows = [date_from]
    for months in FALLBACK_WINDOWS_MONTHS:
        candidate = _initial_date_from(months)
        if candidate > date_from and candidate not in windows:
            windows.append(candidate)

    last_error: DateRangeError | None = None
    for candidate in windows:
        try:
            raw_items = list(client.iter_transactions(account.eb_account_uid, date_from=candidate))
        except DateRangeError as exc:
            logger.warning(
                "Compte %s: el banc rebutja la finestra des de %s (%s)",
                account.eb_account_uid,
                candidate,
                exc,
            )
            last_error = exc
            continue
        parsed = [item for raw in raw_items if (item := parse_transaction(raw)) is not None]
        return parsed, candidate

    raise last_error or DateRangeError("No s'ha pogut trobar cap finestra de dates acceptada")


def _apply_descriptors(
    db: Session, account: Account, transaction: Transaction, parsed: ParsedTransaction
) -> None:
    normalized, display = normalize_description(parsed.description, parsed.counterparty)
    transaction.normalized_description = normalized
    if account.ledger_id is None:
        # Compte encara sense espai: no hi ha memoria de comercos on desar-lo.
        return
    merchant = get_or_create_merchant(
        db, account.ledger_id, normalized, display, seen_on=parsed.booking_date
    )
    if merchant is not None:
        transaction.merchant_id = merchant.id


def _upsert_transactions(
    db: Session, account: Account, parsed_items: list[ParsedTransaction]
) -> AccountSyncResult:
    result = AccountSyncResult(account_id=account.id)
    if not parsed_items:
        return result

    window_start = min(item.booking_date for item in parsed_items) - timedelta(
        days=PENDING_MATCH_DAYS
    )
    existing = list(
        db.scalars(
            select(Transaction).where(
                Transaction.account_id == account.id,
                Transaction.booking_date >= window_start,
            )
        )
    )
    by_key = {item.dedup_key: item for item in existing}
    pending = [item for item in existing if item.status == TransactionStatus.PENDING]
    seen_keys: set[str] = set()
    # Es carreguen un sol cop: la mateixa llista serveix per a tots els moviments.
    rules = active_rules(db, account.ledger_id) if account.ledger_id is not None else []

    for parsed in parsed_items:
        key = parsed.dedup_key()
        seen_keys.add(key)

        if (current := by_key.get(key)) is not None:
            if _update_transaction(current, parsed):
                result.updated += 1
            continue

        # Un apunt pendent que es consolida no ha de duplicar-se: es reaprofita
        # la fila existent per conservar la categoria que hi hagi posat l'usuari.
        if parsed.status == TransactionStatus.BOOKED:
            match = _match_pending(pending, parsed)
            if match is not None:
                pending.remove(match)
                by_key.pop(match.dedup_key, None)
                match.dedup_key = key
                match.entry_reference = parsed.entry_reference
                match.transaction_id = parsed.transaction_id
                _update_transaction(match, parsed)
                by_key[key] = match
                result.updated += 1
                continue

        transaction = Transaction(
            account_id=account.id,
            ledger_id=account.ledger_id,
            entry_reference=parsed.entry_reference,
            transaction_id=parsed.transaction_id,
            dedup_key=key,
            booking_date=parsed.booking_date,
            value_date=parsed.value_date,
            amount=parsed.amount,
            currency=parsed.currency,
            status=parsed.status,
            description=parsed.description,
            counterparty=parsed.counterparty,
            bank_transaction_code=parsed.bank_transaction_code,
            raw=parsed.raw,
        )
        db.add(transaction)
        db.flush()
        _apply_descriptors(db, account, transaction, parsed)
        classify_transaction(db, transaction, rules)
        by_key[key] = transaction
        result.inserted += 1

    # Els pendents que el banc ja no reporta han desaparegut: s'esborren.
    for stale in pending:
        if stale.dedup_key not in seen_keys and stale.booking_date >= window_start:
            db.delete(stale)
            result.removed += 1

    booked_dates = [
        item.booking_date for item in parsed_items if item.status == TransactionStatus.BOOKED
    ]
    if booked_dates:
        newest = max(booked_dates)
        if account.last_booked_date is None or newest > account.last_booked_date:
            account.last_booked_date = newest
    oldest = min(item.booking_date for item in parsed_items)
    if account.history_start_date is None or oldest < account.history_start_date:
        account.history_start_date = oldest

    db.flush()
    return result


def _match_pending(pending: list[Transaction], parsed: ParsedTransaction) -> Transaction | None:
    for candidate in pending:
        if candidate.amount != parsed.amount:
            continue
        if abs((candidate.booking_date - parsed.booking_date).days) > PENDING_MATCH_DAYS:
            continue
        return candidate
    return None


def _update_transaction(transaction: Transaction, parsed: ParsedTransaction) -> bool:
    """Actualitza els camps que el banc pot canviar. Retorna si hi ha hagut canvis."""
    changed = False
    for attribute, value in (
        ("status", parsed.status),
        ("booking_date", parsed.booking_date),
        ("value_date", parsed.value_date),
        ("amount", parsed.amount),
        ("description", parsed.description),
        ("counterparty", parsed.counterparty),
    ):
        if getattr(transaction, attribute) != value:
            setattr(transaction, attribute, value)
            changed = True
    if changed:
        transaction.raw = parsed.raw
    return changed


def _sync_balances(db: Session, client: EnableBankingClient, account: Account) -> None:
    fetched_at = utcnow()
    for raw in client.get_balances(account.eb_account_uid):
        data = parse_balance(raw)
        if data is None or data["reference_date"] is None:
            continue
        existing = db.scalar(
            select(Balance).where(
                Balance.account_id == account.id,
                Balance.balance_type == data["balance_type"],
                Balance.reference_date == data["reference_date"],
            )
        )
        if existing is None:
            db.add(Balance(account_id=account.id, fetched_at=fetched_at, **data))
        else:
            existing.amount = data["amount"]
            existing.fetched_at = fetched_at
    db.flush()


def sync_connection(
    db: Session,
    connection: BankConnection,
    *,
    trigger: SyncTrigger = SyncTrigger.SCHEDULED,
    days_back: int | None = None,
    client: EnableBankingClient | None = None,
) -> SyncResult:
    """Sincronitza tots els comptes actius d'una connexio."""
    run = SyncRun(
        connection_id=connection.id,
        trigger=trigger,
        status=SyncStatus.RUNNING,
        started_at=utcnow(),
    )
    db.add(run)
    db.flush()

    result = SyncResult(connection_id=connection.id)
    owned_client = client is None
    client = client or EnableBankingClient()

    try:
        for account in connection.accounts:
            if not account.is_active:
                continue
            account_result = AccountSyncResult(account_id=account.id)
            try:
                date_from = _date_from_for(account, days_back)
                parsed_items, used_from = _fetch_transactions(client, account, date_from)
                logger.info(
                    "Compte %s: %s moviments des de %s",
                    account.display_name,
                    len(parsed_items),
                    used_from,
                )
                account_result = _upsert_transactions(db, account, parsed_items)
                _sync_balances(db, client, account)
            except SessionExpiredError as exc:
                _mark_expired(db, connection, str(exc))
                result.errors.append(f"Consentiment caducat: {exc}")
                break
            except EnableBankingError as exc:
                logger.exception("Error sincronitzant el compte %s", account.eb_account_uid)
                account_result.error = str(exc)
                result.errors.append(f"{account.display_name}: {exc}")
            result.accounts.append(account_result)

        connection.last_sync_at = utcnow()
        if result.errors and not result.accounts:
            run.status = SyncStatus.FAILED
        elif result.errors:
            run.status = SyncStatus.PARTIAL
        else:
            run.status = SyncStatus.SUCCESS
            connection.last_error = ""
    except Exception as exc:  # noqa: BLE001
        logger.exception("Sincronitzacio fallida de la connexio %s", connection.id)
        run.status = SyncStatus.FAILED
        result.errors.append(str(exc))
        connection.last_error = str(exc)
        _alert_sync_failed(db, connection, str(exc))
    finally:
        if owned_client:
            client.close()
        run.finished_at = utcnow()
        run.accounts_synced = len(result.accounts)
        run.transactions_inserted = result.inserted
        run.transactions_updated = result.updated
        run.error = "; ".join(result.errors)[:2000]
        db.flush()

    if result.errors and run.status != SyncStatus.SUCCESS:
        connection.last_error = "; ".join(result.errors)[:2000]
        if run.status == SyncStatus.FAILED:
            _alert_sync_failed(db, connection, connection.last_error)

    return result


def _mark_expired(db: Session, connection: BankConnection, message: str) -> None:
    connection.status = ConnectionStatus.EXPIRED
    connection.last_error = message
    create_alert(
        db,
        type=AlertType.CONSENT_EXPIRED,
        dedup_key=f"consent-expired:{connection.id}:{today_local().isoformat()}",
        title=f"El consentiment de {connection.aspsp_name} ha caducat",
        body=(
            "Cal tornar a autoritzar l'acces al banc des de la pantalla de connexions. "
            "Fins llavors no s'importaran moviments nous."
        ),
        severity=AlertSeverity.CRITICAL,
        payload={"connection_id": connection.id},
    )


def _alert_sync_failed(db: Session, connection: BankConnection, message: str) -> None:
    create_alert(
        db,
        type=AlertType.SYNC_FAILED,
        dedup_key=f"sync-failed:{connection.id}:{today_local().isoformat()}",
        title=f"La sincronitzacio amb {connection.aspsp_name} ha fallat",
        body=message[:1000],
        severity=AlertSeverity.WARNING,
        payload={"connection_id": connection.id},
    )


def check_consents(db: Session, warn_days: tuple[int, ...] = (7, 3, 1)) -> list[BankConnection]:
    """Avisa dels consentiments a punt de caducar."""
    expiring: list[BankConnection] = []
    now = utcnow()
    for connection in db.scalars(
        select(BankConnection).where(BankConnection.status == ConnectionStatus.ACTIVE)
    ):
        if connection.valid_until is None:
            continue
        days_left = (connection.valid_until - now).days
        if days_left < 0:
            _mark_expired(db, connection, "El periode de validesa ha finalitzat")
            expiring.append(connection)
            continue
        if days_left in warn_days:
            create_alert(
                db,
                type=AlertType.CONSENT_EXPIRING,
                dedup_key=f"consent-expiring:{connection.id}:{days_left}",
                title=f"El consentiment de {connection.aspsp_name} caduca en {days_left} dies",
                body=(
                    "Entra a la pantalla de connexions i torna a autoritzar l'acces "
                    "abans que caduqui, per no perdre cap moviment."
                ),
                severity=AlertSeverity.CRITICAL if days_left <= 1 else AlertSeverity.WARNING,
                payload={"connection_id": connection.id, "days_left": days_left},
            )
            expiring.append(connection)
    db.flush()
    return expiring
