"""Autenticació. L'accés als espais es prova a test_espais.py."""

from __future__ import annotations

from tests.conftest import login, make_user


def test_login_correcte(client, db):
    make_user(db, "anna@example.com")

    response = client.post(
        "/api/auth/login", json={"email": "anna@example.com", "password": "contrasenya-llarga"}
    )

    assert response.status_code == 200
    assert response.json()["email"] == "anna@example.com"


def test_login_incorrecte(client, db):
    make_user(db, "anna@example.com")
    response = client.post(
        "/api/auth/login", json={"email": "anna@example.com", "password": "malament"}
    )
    assert response.status_code == 401


def test_un_usuari_desactivat_no_pot_entrar(client, db):
    user = make_user(db, "anna@example.com")
    user.is_active = False
    db.flush()

    response = client.post(
        "/api/auth/login", json={"email": "anna@example.com", "password": "contrasenya-llarga"}
    )

    assert response.status_code == 401


def test_sense_sessio_no_hi_ha_acces(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/workspaces").status_code == 401


def test_logout_invalida_la_sessio(client, db):
    make_user(db, "anna@example.com")
    login(client, "anna@example.com")

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_canviar_la_contrasenya_tanca_les_sessions(client, db):
    make_user(db, "anna@example.com")
    login(client, "anna@example.com")

    response = client.post(
        "/api/auth/password",
        json={"current_password": "contrasenya-llarga", "new_password": "una-de-nova-llarga"},
    )

    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_la_contrasenya_actual_ha_de_ser_correcta(client, db):
    make_user(db, "anna@example.com")
    login(client, "anna@example.com")

    response = client.post(
        "/api/auth/password",
        json={"current_password": "no-es-aquesta", "new_password": "una-de-nova-llarga"},
    )

    assert response.status_code == 400
    assert client.get("/api/auth/me").status_code == 200
