"""Autenticacio i control d'acces per llibre."""

from __future__ import annotations

from tests.conftest import grant, login, make_user
from app.models.enums import LedgerRole


def test_login_correcte_retorna_els_llibres_permesos(client, db, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"], LedgerRole.VIEWER)

    response = client.post(
        "/api/auth/login", json={"email": "anna@example.com", "password": "contrasenya-llarga"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "anna@example.com"
    assert [item["ledger_code"] for item in body["ledgers"]] == ["calella"]


def test_login_incorrecte(client, db):
    make_user(db, "anna@example.com")
    response = client.post(
        "/api/auth/login", json={"email": "anna@example.com", "password": "malament"}
    )
    assert response.status_code == 401


def test_sense_sessio_no_hi_ha_acces(client):
    assert client.get("/api/auth/me").status_code == 401


def test_nomes_es_veuen_els_llibres_permesos(client, db, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")

    codes = [item["code"] for item in client.get("/api/ledgers").json()]
    assert codes == ["calella"]


def test_un_llibre_alie_dona_403(client, db, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")

    assert client.get(f"/api/ledgers/{ledgers['personal'].id}").status_code == 403


def test_administrador_veu_tots_els_llibres(client, db, ledgers):
    make_user(db, "admin@example.com", is_admin=True)
    login(client, "admin@example.com")

    codes = sorted(item["code"] for item in client.get("/api/ledgers").json())
    assert codes == ["calella", "pardals", "personal"]


def test_logout_invalida_la_sessio(client, db, ledgers):
    make_user(db, "anna@example.com")
    login(client, "anna@example.com")
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
