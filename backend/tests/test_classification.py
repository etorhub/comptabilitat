"""Regles, memoria de comercos, revisio i traspassos."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Account, BankConnection, Category, Merchant, Rule, Transaction
from app.models.enums import CategorySource, ConnectionStatus, RuleSource, TransactionStatus
from app.services.classification import classify_pending, classify_transaction
from app.services.seed import SLUG_INTERNAL_TRANSFER
from app.services.transfers import detect_transfers
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
            name=f"Compte {code}",
        )
        db.add(account)
        accounts[code] = account
    db.flush()
    return accounts


def moviment(db, account, amount, day=None, description="COMPRA EN MERCADONA", **kwargs):
    transaction = Transaction(
        account_id=account.id,
        ledger_id=account.ledger_id,
        dedup_key=f"k-{account.id}-{amount}-{day or date.today()}-{description[:10]}",
        booking_date=day or date.today(),
        amount=Decimal(str(amount)),
        description=description,
        normalized_description=kwargs.pop("normalized", "MERCADONA"),
        status=TransactionStatus.BOOKED,
        **kwargs,
    )
    db.add(transaction)
    db.flush()
    return transaction


def categoria(db, slug_part="supermercat") -> Category:
    return db.scalar(select(Category).where(Category.slug.like(f"%{slug_part}%")))


def test_una_regla_assigna_la_categoria(db, comptes, categories):
    supermercat = categoria(db)
    db.add(
        Rule(
            name="Mercadona",
            priority=10,
            conditions=[
                {"field": "normalized_description", "operator": "contains", "value": "MERCADONA"}
            ],
            set_category_id=supermercat.id,
        )
    )
    db.flush()
    transaction = moviment(db, comptes["personal"], "-30.00")

    classify_transaction(db, transaction)

    assert transaction.category_id == supermercat.id
    assert transaction.category_source is CategorySource.RULE
    assert transaction.needs_review is False


def test_les_regles_respecten_la_prioritat(db, comptes, categories):
    supermercat = categoria(db)
    restaurants = categoria(db, "restaurants")
    db.add_all(
        [
            Rule(
                name="general",
                priority=100,
                conditions=[{"field": "description", "operator": "contains", "value": "COMPRA"}],
                set_category_id=restaurants.id,
            ),
            Rule(
                name="especifica",
                priority=10,
                conditions=[{"field": "description", "operator": "contains", "value": "MERCADONA"}],
                set_category_id=supermercat.id,
            ),
        ]
    )
    db.flush()
    transaction = moviment(db, comptes["personal"], "-30.00")

    classify_transaction(db, transaction)

    assert transaction.category_id == supermercat.id


def test_una_regla_dun_llibre_no_afecta_els_altres(db, comptes, categories, ledgers):
    supermercat = categoria(db)
    db.add(
        Rule(
            name="nomes calella",
            ledger_id=ledgers["calella"].id,
            conditions=[
                {"field": "normalized_description", "operator": "contains", "value": "MERCADONA"}
            ],
            set_category_id=supermercat.id,
        )
    )
    db.flush()
    personal = moviment(db, comptes["personal"], "-30.00")
    calella = moviment(db, comptes["calella"], "-30.00")

    classify_transaction(db, personal)
    classify_transaction(db, calella)

    assert personal.category_id is None
    assert calella.category_id == supermercat.id


def test_la_memoria_de_comercos_classifica_sense_regla(db, comptes, categories):
    supermercat = categoria(db)
    merchant = Merchant(
        normalized_name="MERCADONA",
        display_name="Mercadona",
        default_category_id=supermercat.id,
        is_confirmed=True,
    )
    db.add(merchant)
    db.flush()
    transaction = moviment(db, comptes["personal"], "-30.00", merchant_id=merchant.id)

    classify_transaction(db, transaction)

    assert transaction.category_id == supermercat.id
    assert transaction.category_source is CategorySource.MERCHANT
    assert transaction.needs_review is False


def test_un_comerc_no_confirmat_es_marca_per_revisar(db, comptes, categories):
    supermercat = categoria(db)
    merchant = Merchant(
        normalized_name="MERCADONA",
        display_name="Mercadona",
        default_category_id=supermercat.id,
        is_confirmed=False,
    )
    db.add(merchant)
    db.flush()
    transaction = moviment(db, comptes["personal"], "-30.00", merchant_id=merchant.id)

    classify_transaction(db, transaction)

    assert transaction.needs_review is True


def test_la_decisio_de_lusuari_no_es_sobreescriu(db, comptes, categories):
    supermercat = categoria(db)
    restaurants = categoria(db, "restaurants")
    db.add(
        Rule(
            name="Mercadona",
            conditions=[
                {"field": "normalized_description", "operator": "contains", "value": "MERCADONA"}
            ],
            set_category_id=supermercat.id,
        )
    )
    db.flush()
    transaction = moviment(
        db,
        comptes["personal"],
        "-30.00",
        category_id=restaurants.id,
        category_source=CategorySource.USER,
    )

    classify_transaction(db, transaction)

    assert transaction.category_id == restaurants.id


def test_els_moviments_sense_res_queden_per_revisar(db, comptes, categories):
    moviment(db, comptes["personal"], "-30.00", description="ALGUNA COSA RARA")

    stats = classify_pending(db)

    assert stats.unresolved == 1
    transaction = db.scalar(select(Transaction))
    assert transaction.needs_review is True


def test_els_traspassos_entre_comptes_saparellen(db, comptes, categories):
    avui = date.today()
    sortida = moviment(db, comptes["personal"], "-500.00", avui, description="TRASPASO A CALELLA")
    entrada = moviment(
        db, comptes["calella"], "500.00", avui + timedelta(days=1), description="TRASPASO DE"
    )

    pairs = detect_transfers(db)

    assert pairs == 1
    assert sortida.transfer_group_id is not None
    assert sortida.transfer_group_id == entrada.transfer_group_id
    traspas = db.scalar(select(Category).where(Category.slug == SLUG_INTERNAL_TRANSFER))
    assert sortida.category_id == traspas.id


def test_no_saparellen_moviments_del_mateix_compte(db, comptes, categories):
    avui = date.today()
    moviment(db, comptes["personal"], "-500.00", avui, description="UNA COSA")
    moviment(db, comptes["personal"], "500.00", avui, description="UNA ALTRA")

    assert detect_transfers(db) == 0


def test_no_saparellen_moviments_massa_separats(db, comptes, categories):
    avui = date.today()
    moviment(db, comptes["personal"], "-500.00", avui)
    moviment(db, comptes["calella"], "500.00", avui + timedelta(days=10))

    assert detect_transfers(db) == 0


def test_canviar_la_categoria_recorda_el_comerc(client, db, comptes, categories, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")
    merchant = Merchant(normalized_name="MERCADONA", display_name="Mercadona")
    db.add(merchant)
    db.flush()
    primer = moviment(db, comptes["personal"], "-30.00", merchant_id=merchant.id)
    segon = moviment(
        db, comptes["personal"], "-12.00", date.today() - timedelta(days=1), merchant_id=merchant.id
    )
    supermercat = categoria(db)

    response = client.patch(
        f"/api/transactions/{primer.id}",
        json={"category_id": supermercat.id, "remember_merchant": True},
    )

    assert response.status_code == 200
    db.refresh(merchant)
    db.refresh(segon)
    assert merchant.default_category_id == supermercat.id
    assert merchant.is_confirmed is True
    assert segon.category_id == supermercat.id, "la decisio s'ha de propagar al mateix comerc"
    db.refresh(primer)
    assert primer.category_source is CategorySource.USER


def test_crear_una_regla_apresa_des_duna_correccio(client, db, comptes, categories, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")
    transaction = moviment(db, comptes["personal"], "-30.00")
    supermercat = categoria(db)

    response = client.patch(
        f"/api/transactions/{transaction.id}",
        json={"category_id": supermercat.id, "create_rule": True},
    )

    assert response.status_code == 200
    rule = db.scalar(select(Rule).where(Rule.source == RuleSource.LEARNED))
    assert rule is not None
    assert rule.set_category_id == supermercat.id


def test_no_es_poden_tocar_moviments_dun_altre_llibre(client, db, comptes, categories, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")
    alie = moviment(db, comptes["calella"], "-30.00")
    supermercat = categoria(db)

    response = client.patch(f"/api/transactions/{alie.id}", json={"category_id": supermercat.id})

    assert response.status_code == 403


def test_la_llista_de_moviments_nomes_mostra_els_llibres_permesos(
    client, db, comptes, categories, ledgers
):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")
    moviment(db, comptes["personal"], "-30.00")
    moviment(db, comptes["calella"], "-99.00")

    body = client.get("/api/transactions").json()

    assert body["total"] == 1
    assert body["items"][0]["amount"] == "-30.00"


def test_la_cua_de_revisio_llista_els_pendents(client, db, comptes, categories, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")
    moviment(db, comptes["personal"], "-30.00", needs_review=True)
    moviment(db, comptes["personal"], "-10.00", date.today() - timedelta(days=2))

    body = client.get("/api/transactions/review").json()

    assert body["total"] == 1
    assert body["items"][0]["transaction"]["amount"] == "-30.00"


def test_recategoritzacio_en_lot(client, db, comptes, categories, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")
    primer = moviment(db, comptes["personal"], "-30.00")
    segon = moviment(db, comptes["personal"], "-40.00", date.today() - timedelta(days=1))
    supermercat = categoria(db)

    response = client.post(
        "/api/transactions/bulk-categorize",
        json={"transaction_ids": [primer.id, segon.id], "category_id": supermercat.id},
    )

    assert response.status_code == 200
    db.refresh(primer)
    db.refresh(segon)
    assert primer.category_id == segon.category_id == supermercat.id
