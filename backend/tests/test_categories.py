"""Proves de CRUD de categories."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.models import Account, BankConnection, Category, Merchant, Rule, Transaction
from app.models.enums import CategoryKind, ConnectionStatus, RuleSource, TransactionStatus
from app.services.seed import SLUG_UNCATEGORIZED
from tests.conftest import categoria, grant_all, login, make_user


@pytest.fixture
def comptes(db, ledgers) -> dict[str, Account]:
    connection = BankConnection(
        aspsp_name="Santander", aspsp_country="ES", status=ConnectionStatus.ACTIVE
    )
    db.add(connection)
    db.flush()
    accounts = {}
    for code, ledger in ledgers.items():
        account = Account(
            connection_id=connection.id, ledger_id=ledger.id, eb_account_uid=f"uid-{code}"
        )
        db.add(account)
        accounts[code] = account
    db.flush()
    return accounts


def _login_editor(client, db, ledgers):
    user = make_user(db, "editor@example.com")
    grant_all(db, user, ledgers)
    login(client, "editor@example.com")
    return user


def test_crea_categoria_de_primer_nivell(client, db, ledgers):
    _login_editor(client, db, ledgers)

    resposta = client.post(
        "/api/workspaces/personal/categories",
        json={"name": "Proves", "kind": "expense"},
    )

    assert resposta.status_code == 201
    dades = resposta.json()
    assert dades["name"] == "Proves"
    assert dades["parent_id"] is None
    assert dades["kind"] == "expense"
    assert dades["is_subscription"] is False


def test_crea_subcategoria_hereta_kind(client, db, ledgers):
    _login_editor(client, db, ledgers)
    pare = categoria(db, ledgers["personal"], "alimentacio")

    resposta = client.post(
        "/api/workspaces/personal/categories",
        json={"name": "Fruta", "kind": "income", "parent_id": pare.id},
    )

    assert resposta.status_code == 201
    dades = resposta.json()
    assert dades["parent_id"] == pare.id
    assert dades["kind"] == "expense"


def test_rebutja_tercer_nivell(client, db, ledgers):
    _login_editor(client, db, ledgers)
    pare = categoria(db, ledgers["personal"], "alimentacio")
    fill = Category(
        ledger_id=ledgers["personal"].id,
        parent_id=pare.id,
        slug="alimentacio-prova",
        name="Prova",
        kind=CategoryKind.EXPENSE,
    )
    db.add(fill)
    db.flush()

    resposta = client.post(
        "/api/workspaces/personal/categories",
        json={"name": "Net", "kind": "expense", "parent_id": fill.id},
    )

    assert resposta.status_code == 400
    assert "dos nivells" in resposta.json()["detail"]


def test_actualitza_nom_i_subscripcio(client, db, ledgers):
    _login_editor(client, db, ledgers)
    categoria_obj = categoria(db, ledgers["personal"], "alimentacio-supermercat")

    resposta = client.patch(
        f"/api/workspaces/personal/categories/{categoria_obj.id}",
        json={"name": "Super", "is_subscription": True},
    )

    assert resposta.status_code == 200
    dades = resposta.json()
    assert dades["name"] == "Super"
    assert dades["is_subscription"] is True


def test_no_esborra_categoria_protegida(client, db, ledgers):
    _login_editor(client, db, ledgers)
    protegida = categoria(db, ledgers["personal"], SLUG_UNCATEGORIZED)

    resposta = client.delete(f"/api/workspaces/personal/categories/{protegida.id}")

    assert resposta.status_code == 400
    assert "sistema" in resposta.json()["detail"]


def test_no_esborra_pare_amb_subcategories(client, db, ledgers):
    _login_editor(client, db, ledgers)
    pare = categoria(db, ledgers["personal"], "alimentacio")

    resposta = client.delete(f"/api/workspaces/personal/categories/{pare.id}")

    assert resposta.status_code == 400
    assert "subcategories" in resposta.json()["detail"]


def test_esborra_amb_reassignacio(client, db, ledgers, comptes):
    _login_editor(client, db, ledgers)
    origen = categoria(db, ledgers["personal"], "alimentacio-supermercat")
    desti = categoria(db, ledgers["personal"], "alimentacio-mercat-i-fruiteria")
    merchant = Merchant(
        ledger_id=ledgers["personal"].id,
        normalized_name="MERCADONA",
        display_name="Mercadona",
        default_category_id=origen.id,
    )
    db.add(merchant)
    db.flush()
    regla = Rule(
        ledger_id=ledgers["personal"].id,
        name="Mercadona",
        set_category_id=origen.id,
        source=RuleSource.USER,
    )
    db.add(regla)
    db.flush()
    moviment = Transaction(
        account_id=comptes["personal"].id,
        ledger_id=ledgers["personal"].id,
        dedup_key="cat-del-1",
        booking_date=date.today(),
        amount=Decimal("-25.00"),
        description="MERCADONA",
        normalized_description="MERCADONA",
        merchant_id=merchant.id,
        category_id=origen.id,
        status=TransactionStatus.BOOKED,
    )
    db.add(moviment)
    db.flush()

    resposta = client.delete(
        f"/api/workspaces/personal/categories/{origen.id}",
        params={"reassign_to": desti.id},
    )

    assert resposta.status_code == 200
    db.expire_all()
    assert db.get(Category, origen.id) is None
    assert db.get(Transaction, moviment.id).category_id == desti.id
    assert db.get(Merchant, merchant.id).default_category_id == desti.id
    assert db.get(Rule, regla.id).set_category_id == desti.id


def test_esborra_sense_reassignacio_retorna_409(client, db, ledgers, comptes):
    _login_editor(client, db, ledgers)
    origen = categoria(db, ledgers["personal"], "alimentacio-supermercat")
    moviment = Transaction(
        account_id=comptes["personal"].id,
        ledger_id=ledgers["personal"].id,
        dedup_key="cat-del-2",
        booking_date=date.today(),
        amount=Decimal("-10.00"),
        description="PROVA",
        normalized_description="PROVA",
        category_id=origen.id,
        status=TransactionStatus.BOOKED,
    )
    db.add(moviment)
    db.flush()

    resposta = client.delete(f"/api/workspaces/personal/categories/{origen.id}")

    assert resposta.status_code == 409
    assert "1 moviments" in resposta.json()["detail"]


def test_estadistiques_agreguen_subcategories(client, db, ledgers, comptes):
    _login_editor(client, db, ledgers)
    pare = categoria(db, ledgers["personal"], "alimentacio")
    fill = categoria(db, ledgers["personal"], "alimentacio-supermercat")
    db.add(
        Transaction(
            account_id=comptes["personal"].id,
            ledger_id=ledgers["personal"].id,
            dedup_key="cat-stat-1",
            booking_date=date.today(),
            amount=Decimal("-30.00"),
            description="MERCADONA",
            normalized_description="MERCADONA",
            category_id=fill.id,
            status=TransactionStatus.BOOKED,
        )
    )
    db.flush()

    resposta = client.get("/api/workspaces/personal/categories", params={"with_stats": True})

    assert resposta.status_code == 200
    per_id = {item["id"]: item for item in resposta.json()}
    assert per_id[fill.id]["transaction_count"] == 1
    assert Decimal(per_id[fill.id]["total_amount"]) == Decimal("-30.00")
    assert per_id[pare.id]["transaction_count"] == 1
    assert Decimal(per_id[pare.id]["total_amount"]) == Decimal("-30.00")
