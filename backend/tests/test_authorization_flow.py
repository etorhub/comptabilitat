"""Flux complet d'autoritzacio: inici, retorn del banc i alta dels comptes."""

from __future__ import annotations

import httpx
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app.config import settings
from app.models import Account, BankConnection
from app.models.enums import ConnectionStatus
from tests.conftest import login, make_user

BASE = "https://api.enablebanking.com"


@pytest.fixture(autouse=True)
def credencials(monkeypatch) -> None:
    """Credencials de proves perque el client pugui signar el JWT."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    monkeypatch.setattr(settings, "eb_application_id", "app-de-proves")
    monkeypatch.setattr(settings, "eb_private_key", pem)
    monkeypatch.setattr(settings, "public_base_url", "https://comptes.example")


@pytest.fixture
def admin(client, db):
    make_user(db, "admin@example.com", is_admin=True)
    login(client, "admin@example.com")


SESSIO = {
    "session_id": "sessio-abc",
    "access": {"valid_until": "2026-11-20T10:00:00.000Z"},
    "aspsp": {"name": "Santander", "country": "ES"},
    "accounts": [
        {
            "uid": "uid-1",
            "name": "Compte corrent",
            "account_id": {"iban": "ES9121000418450200051332"},
            "currency": "EUR",
            "cash_account_type": "CACC",
        },
        {
            "uid": "uid-2",
            "name": "Compte estalvi",
            "account_id": {"iban": "ES7620770024003102575766"},
            "currency": "EUR",
            "cash_account_type": "SVGS",
        },
    ],
}


@respx.mock
def test_el_flux_dautoritzacio_dona_dalta_els_comptes(client, db, admin, ledgers):
    respx.post(f"{BASE}/auth").mock(
        return_value=httpx.Response(200, json={"url": "https://banc.example/sca?x=1"})
    )
    respx.post(f"{BASE}/sessions").mock(return_value=httpx.Response(200, json=SESSIO))

    response = client.post("/api/connections/authorize", json={"aspsp_name": "Santander"})
    assert response.status_code == 200
    assert response.json()["authorization_url"] == "https://banc.example/sca?x=1"

    connection = db.scalar(select(BankConnection))
    assert connection is not None and connection.status == ConnectionStatus.PENDING
    state = connection.eb_auth_state
    assert state

    callback = client.get(
        "/api/auth/callback", params={"code": "codi-1", "state": state}, follow_redirects=False
    )
    assert callback.status_code == 303
    assert "estat=ok" in callback.headers["location"]

    db.refresh(connection)
    assert connection.status == ConnectionStatus.ACTIVE
    assert connection.eb_session_id == "sessio-abc"
    assert connection.valid_until is not None
    assert connection.eb_auth_state is None

    accounts = list(db.scalars(select(Account).order_by(Account.eb_account_uid)))
    assert [account.eb_account_uid for account in accounts] == ["uid-1", "uid-2"]
    # Els comptes arriben sense llibre: l'assigna l'usuari despres.
    assert all(account.ledger_id is None for account in accounts)


@respx.mock
def test_un_estat_desconegut_no_crea_cap_sessio(client, db, admin):
    respx.post(f"{BASE}/sessions").mock(return_value=httpx.Response(200, json=SESSIO))

    callback = client.get(
        "/api/auth/callback",
        params={"code": "codi-1", "state": "inventat"},
        follow_redirects=False,
    )

    assert callback.status_code == 303
    assert "estat=error" in callback.headers["location"]
    assert db.scalar(select(BankConnection)) is None


def test_el_banc_pot_tornar_un_error(client, db, admin):
    callback = client.get(
        "/api/auth/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert callback.status_code == 303
    assert "estat=error" in callback.headers["location"]


@respx.mock
def test_renovar_el_consentiment_conserva_els_comptes(client, db, admin, ledgers):
    respx.post(f"{BASE}/auth").mock(
        return_value=httpx.Response(200, json={"url": "https://banc.example/sca"})
    )
    respx.post(f"{BASE}/sessions").mock(return_value=httpx.Response(200, json=SESSIO))

    client.post("/api/connections/authorize", json={"aspsp_name": "Santander"})
    connection = db.scalar(select(BankConnection))
    client.get(
        "/api/auth/callback",
        params={"code": "codi-1", "state": connection.eb_auth_state},
        follow_redirects=False,
    )
    account = db.scalar(select(Account).where(Account.eb_account_uid == "uid-1"))
    account.ledger_id = ledgers["calella"].id
    db.flush()

    # Segona autoritzacio sobre la mateixa connexio, com quan caduca el consentiment.
    client.post("/api/connections/authorize", json={"connection_id": connection.id})
    db.refresh(connection)
    client.get(
        "/api/auth/callback",
        params={"code": "codi-2", "state": connection.eb_auth_state},
        follow_redirects=False,
    )

    accounts = list(db.scalars(select(Account)))
    assert len(accounts) == 2, "no s'han de duplicar els comptes en renovar"
    db.refresh(account)
    assert account.ledger_id == ledgers["calella"].id


def test_un_usuari_normal_no_pot_gestionar_connexions(client, db, ledgers):
    make_user(db, "anna@example.com")
    login(client, "anna@example.com")

    assert client.get("/api/connections").status_code == 403
    assert client.post("/api/connections/authorize", json={}).status_code == 403
