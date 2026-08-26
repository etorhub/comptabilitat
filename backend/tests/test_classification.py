"""Regles, memòria de comerços i cua de revisió, dins d'un espai."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Account, BankConnection, Merchant, Rule, Transaction
from app.models.enums import CategorySource, ConnectionStatus, RuleSource, TransactionStatus
from app.services.classification import classify_pending, classify_transaction
from tests.conftest import categoria, grant, login, make_user


@pytest.fixture
def espai(ledgers):
    return ledgers["personal"]


@pytest.fixture
def compte(db, espai) -> Account:
    connection = BankConnection(
        aspsp_name="Santander", aspsp_country="ES", status=ConnectionStatus.ACTIVE
    )
    db.add(connection)
    db.flush()
    account = Account(connection_id=connection.id, ledger_id=espai.id, eb_account_uid="uid-1")
    db.add(account)
    db.flush()
    return account


def moviment(db, compte, amount="-30.00", dia=None, normalized="MERCADONA", **kwargs):
    transaction = Transaction(
        account_id=compte.id,
        ledger_id=compte.ledger_id,
        dedup_key=f"k-{compte.id}-{amount}-{dia or date.today()}-{normalized[:8]}",
        booking_date=dia or date.today(),
        amount=Decimal(str(amount)),
        description=kwargs.pop("description", f"COMPRA EN {normalized}"),
        normalized_description=normalized,
        status=TransactionStatus.BOOKED,
        **kwargs,
    )
    db.add(transaction)
    db.flush()
    return transaction


def comerc(db, espai, nom="MERCADONA", **kwargs) -> Merchant:
    merchant = Merchant(
        ledger_id=espai.id, normalized_name=nom, display_name=nom.capitalize(), **kwargs
    )
    db.add(merchant)
    db.flush()
    return merchant


def test_una_regla_assigna_la_categoria(db, compte, espai):
    supermercat = categoria(db, espai)
    db.add(
        Rule(
            name="Mercadona",
            ledger_id=espai.id,
            priority=10,
            conditions=[
                {"field": "normalized_description", "operator": "contains", "value": "MERCADONA"}
            ],
            set_category_id=supermercat.id,
        )
    )
    db.flush()
    transaction = moviment(db, compte)

    classify_transaction(db, transaction)

    assert transaction.category_id == supermercat.id
    assert transaction.category_source is CategorySource.RULE
    assert transaction.needs_review is False


def test_les_regles_respecten_la_prioritat(db, compte, espai):
    supermercat = categoria(db, espai)
    restaurants = categoria(db, espai, "restauracio-restaurants")
    db.add_all(
        [
            Rule(
                name="general",
                ledger_id=espai.id,
                priority=100,
                conditions=[{"field": "description", "operator": "contains", "value": "COMPRA"}],
                set_category_id=restaurants.id,
            ),
            Rule(
                name="especifica",
                ledger_id=espai.id,
                priority=10,
                conditions=[{"field": "description", "operator": "contains", "value": "MERCADONA"}],
                set_category_id=supermercat.id,
            ),
        ]
    )
    db.flush()
    transaction = moviment(db, compte)

    classify_transaction(db, transaction)

    assert transaction.category_id == supermercat.id


def test_la_memoria_de_comercos_classifica_sense_regla(db, compte, espai):
    supermercat = categoria(db, espai)
    merchant = comerc(db, espai, default_category_id=supermercat.id, is_confirmed=True)
    transaction = moviment(db, compte, merchant_id=merchant.id)

    classify_transaction(db, transaction)

    assert transaction.category_id == supermercat.id
    assert transaction.category_source is CategorySource.MERCHANT
    assert transaction.needs_review is False


def test_un_comerc_no_confirmat_es_marca_per_revisar(db, compte, espai):
    supermercat = categoria(db, espai)
    merchant = comerc(db, espai, default_category_id=supermercat.id, is_confirmed=False)
    transaction = moviment(db, compte, merchant_id=merchant.id)

    classify_transaction(db, transaction)

    assert transaction.needs_review is True


def test_la_decisio_de_lusuari_no_es_sobreescriu(db, compte, espai):
    supermercat = categoria(db, espai)
    restaurants = categoria(db, espai, "restauracio-restaurants")
    db.add(
        Rule(
            name="Mercadona",
            ledger_id=espai.id,
            conditions=[
                {"field": "normalized_description", "operator": "contains", "value": "MERCADONA"}
            ],
            set_category_id=supermercat.id,
        )
    )
    db.flush()
    transaction = moviment(
        db, compte, category_id=restaurants.id, category_source=CategorySource.USER
    )

    classify_transaction(db, transaction)

    assert transaction.category_id == restaurants.id


def test_els_moviments_sense_res_queden_per_revisar(db, compte, espai):
    moviment(db, compte, normalized="ALGUNA COSA RARA")

    stats = classify_pending(db, espai.id)

    assert stats.unresolved == 1
    assert db.scalar(select(Transaction)).needs_review is True


def test_canviar_la_categoria_recorda_el_comerc(client, db, compte, espai):
    user = make_user(db, "anna@example.com")
    grant(db, user, espai)
    login(client, "anna@example.com")
    merchant = comerc(db, espai)
    primer = moviment(db, compte, merchant_id=merchant.id)
    segon = moviment(
        db, compte, "-12.00", date.today() - timedelta(days=1), merchant_id=merchant.id
    )
    supermercat = categoria(db, espai)

    response = client.patch(
        f"/api/workspaces/personal/transactions/{primer.id}",
        json={"category_id": supermercat.id, "remember_merchant": True},
    )

    assert response.status_code == 200
    db.refresh(merchant)
    db.refresh(segon)
    assert merchant.default_category_id == supermercat.id
    assert merchant.is_confirmed is True
    assert segon.category_id == supermercat.id, "la decisio s'ha de propagar al mateix comerc"


def test_crear_una_regla_apresa_des_duna_correccio(client, db, compte, espai):
    user = make_user(db, "anna@example.com")
    grant(db, user, espai)
    login(client, "anna@example.com")
    transaction = moviment(db, compte)

    response = client.patch(
        f"/api/workspaces/personal/transactions/{transaction.id}",
        json={"category_id": categoria(db, espai).id, "create_rule": True},
    )

    assert response.status_code == 200
    rule = db.scalar(select(Rule).where(Rule.source == RuleSource.LEARNED))
    assert rule is not None
    assert rule.ledger_id == espai.id


def test_la_cua_de_revisio_llista_els_pendents(client, db, compte, espai):
    user = make_user(db, "anna@example.com")
    grant(db, user, espai)
    login(client, "anna@example.com")
    moviment(db, compte, needs_review=True)
    moviment(db, compte, "-10.00", date.today() - timedelta(days=2))

    body = client.get("/api/workspaces/personal/transactions/review").json()

    assert body["total"] == 1
    assert body["items"][0]["transaction"]["amount"] == "-30.00"


def test_recategoritzacio_en_lot(client, db, compte, espai):
    user = make_user(db, "anna@example.com")
    grant(db, user, espai)
    login(client, "anna@example.com")
    primer = moviment(db, compte)
    segon = moviment(db, compte, "-40.00", date.today() - timedelta(days=1))
    supermercat = categoria(db, espai)

    response = client.post(
        "/api/workspaces/personal/transactions/bulk-categorize",
        json={"transaction_ids": [primer.id, segon.id], "category_id": supermercat.id},
    )

    assert response.status_code == 200
    db.refresh(primer)
    db.refresh(segon)
    assert primer.category_id == segon.category_id == supermercat.id


def test_la_recategoritzacio_en_lot_no_accepta_moviments_de_fora(client, db, compte, ledgers):
    """Si algun moviment no és de l'espai, no se n'aplica cap."""
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    grant(db, user, ledgers["calella"])
    login(client, "anna@example.com")
    connection = db.scalar(select(BankConnection))
    altre_compte = Account(
        connection_id=connection.id, ledger_id=ledgers["calella"].id, eb_account_uid="uid-2"
    )
    db.add(altre_compte)
    db.flush()
    meu = moviment(db, compte)
    alie = moviment(db, altre_compte)

    response = client.post(
        "/api/workspaces/personal/transactions/bulk-categorize",
        json={
            "transaction_ids": [meu.id, alie.id],
            "category_id": categoria(db, ledgers["personal"]).id,
        },
    )

    assert response.status_code == 404
    db.refresh(meu)
    assert meu.category_source is CategorySource.NONE, "no s'ha d'aplicar res a mitges"
