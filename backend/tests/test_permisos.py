"""Fronteres de permisos entre llibres.

Els noms dels comercos inclouen persones (transferencies, Bizum), aixi que
aquestes proves comproven que un usuari d'un sol llibre no veu ni toca res
dels altres.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Account, BankConnection, Category, Merchant, Rule, Transaction
from app.models.enums import (
    CategorySource,
    ConnectionStatus,
    LedgerRole,
    RuleSource,
    TransactionStatus,
)
from tests.conftest import grant, login, make_user


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
            connection_id=connection.id,
            ledger_id=ledger.id,
            eb_account_uid=f"uid-{code}",
        )
        db.add(account)
        accounts[code] = account
    db.flush()
    return accounts


def comerc_amb_moviment(db, compte, nom, amount="-30.00") -> tuple[Merchant, Transaction]:
    merchant = db.scalar(select(Merchant).where(Merchant.normalized_name == nom))
    if merchant is None:
        merchant = Merchant(normalized_name=nom, display_name=nom.capitalize())
        db.add(merchant)
        db.flush()
    transaction = Transaction(
        account_id=compte.id,
        ledger_id=compte.ledger_id,
        dedup_key=f"k-{compte.id}-{nom}-{amount}",
        booking_date=date.today(),
        amount=Decimal(amount),
        description=f"PAGAMENT {nom}",
        normalized_description=nom,
        merchant_id=merchant.id,
        status=TransactionStatus.BOOKED,
    )
    db.add(transaction)
    db.flush()
    return merchant, transaction


def categoria(db) -> Category:
    return db.scalar(select(Category).where(Category.slug == "alimentacio-supermercat"))


def test_no_es_veuen_els_comercos_dun_altre_llibre(client, db, comptes, ledgers, categories):
    comerc_amb_moviment(db, comptes["personal"], "JOAN PUIG")
    comerc_amb_moviment(db, comptes["calella"], "MERCADONA")
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")

    noms = [item["normalized_name"] for item in client.get("/api/merchants").json()["items"]]

    assert noms == ["MERCADONA"]


def test_ladministrador_veu_tots_els_comercos(client, db, comptes, ledgers, categories):
    comerc_amb_moviment(db, comptes["personal"], "JOAN PUIG")
    comerc_amb_moviment(db, comptes["calella"], "MERCADONA")
    make_user(db, "admin@example.com", is_admin=True)
    login(client, "admin@example.com")

    noms = sorted(item["normalized_name"] for item in client.get("/api/merchants").json()["items"])

    assert noms == ["JOAN PUIG", "MERCADONA"]


def test_no_es_pot_editar_un_comerc_dun_altre_llibre(client, db, comptes, ledgers, categories):
    merchant, _ = comerc_amb_moviment(db, comptes["personal"], "JOAN PUIG")
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")

    resposta = client.patch(
        f"/api/merchants/{merchant.id}", json={"default_category_id": categoria(db).id}
    )

    assert resposta.status_code == 403


def test_un_lector_no_pot_editar_comercos(client, db, comptes, ledgers, categories):
    merchant, _ = comerc_amb_moviment(db, comptes["calella"], "MERCADONA")
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"], LedgerRole.VIEWER)
    login(client, "anna@example.com")

    resposta = client.patch(
        f"/api/merchants/{merchant.id}", json={"default_category_id": categoria(db).id}
    )

    assert resposta.status_code == 403


def test_recordar_un_comerc_no_toca_els_llibres_alienys(client, db, comptes, ledgers, categories):
    """El mateix comerç apareix a dos llibres; només s'ha de recategoritzar el permès."""
    merchant, meu = comerc_amb_moviment(db, comptes["calella"], "MERCADONA")
    _, alie = comerc_amb_moviment(db, comptes["personal"], "MERCADONA", amount="-99.00")
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")
    supermercat = categoria(db)

    resposta = client.patch(
        f"/api/transactions/{meu.id}",
        json={"category_id": supermercat.id, "remember_merchant": True},
    )

    assert resposta.status_code == 200
    db.refresh(meu)
    db.refresh(alie)
    assert meu.category_id == supermercat.id
    assert alie.category_id is None, "el moviment d'un altre llibre no s'ha de tocar"
    # La memòria del comerç sí que és compartida: és el que evita tornar a preguntar.
    db.refresh(merchant)
    assert merchant.default_category_id == supermercat.id


def test_una_regla_apresa_queda_lligada_al_seu_llibre(client, db, comptes, ledgers, categories):
    _, meu = comerc_amb_moviment(db, comptes["calella"], "MERCADONA")
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")

    resposta = client.patch(
        f"/api/transactions/{meu.id}",
        json={"category_id": categoria(db).id, "create_rule": True},
    )

    assert resposta.status_code == 200
    rule = db.scalar(select(Rule).where(Rule.source == RuleSource.LEARNED))
    assert rule is not None
    assert rule.ledger_id == ledgers["calella"].id


def test_no_es_veuen_les_regles_dun_altre_llibre(client, db, ledgers, categories):
    db.add_all(
        [
            Rule(
                name="MERCADONA",
                ledger_id=ledgers["calella"].id,
                conditions=[
                    {"field": "normalized_description", "operator": "equals", "value": "X"}
                ],
                set_category_id=categoria(db).id,
            ),
            Rule(
                name="JOAN PUIG",
                ledger_id=ledgers["personal"].id,
                conditions=[
                    {"field": "normalized_description", "operator": "equals", "value": "Y"}
                ],
                set_category_id=categoria(db).id,
            ),
        ]
    )
    db.flush()
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")

    noms = [regla["name"] for regla in client.get("/api/rules").json()]

    assert noms == ["MERCADONA"]


def test_la_recategoritzacio_en_lot_rebutja_els_moviments_alienys(
    client, db, comptes, ledgers, categories
):
    _, meu = comerc_amb_moviment(db, comptes["calella"], "MERCADONA")
    _, alie = comerc_amb_moviment(db, comptes["personal"], "JOAN PUIG")
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")

    resposta = client.post(
        "/api/transactions/bulk-categorize",
        json={"transaction_ids": [meu.id, alie.id], "category_id": categoria(db).id},
    )

    assert resposta.status_code == 403
    db.refresh(meu)
    assert meu.category_source is CategorySource.NONE, "no s'ha d'aplicar res a mitges"
