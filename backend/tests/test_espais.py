"""Aïllament entre espais.

Cada espai és una comptabilitat estanca amb els seus usuaris. Aquestes proves
comproven que qui no hi té accés no en veu res, ni tan sols que existeixi, i que
res del que es decideix en un espai afecta els altres.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models import (
    Account,
    BankConnection,
    Category,
    Merchant,
    Rule,
    Transaction,
)
from app.models.enums import (
    CategorySource,
    ConnectionStatus,
    LedgerRole,
    RuleSource,
    TransactionStatus,
)
from app.services.classification import classify_pending
from app.services.transfers import detect_transfers
from tests.conftest import categoria, grant, grant_all, login, make_user


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


def moviment(db, compte, nom="MERCADONA", amount="-30.00", dia=None) -> Transaction:
    ledger_id = compte.ledger_id
    merchant = db.scalar(
        select(Merchant).where(Merchant.ledger_id == ledger_id, Merchant.normalized_name == nom)
    )
    if merchant is None:
        merchant = Merchant(ledger_id=ledger_id, normalized_name=nom, display_name=nom.capitalize())
        db.add(merchant)
        db.flush()
    transaction = Transaction(
        account_id=compte.id,
        ledger_id=ledger_id,
        dedup_key=f"k-{compte.id}-{nom}-{amount}-{dia or date.today()}",
        booking_date=dia or date.today(),
        amount=Decimal(amount),
        description=f"PAGAMENT {nom}",
        normalized_description=nom,
        merchant_id=merchant.id,
        status=TransactionStatus.BOOKED,
    )
    db.add(transaction)
    db.flush()
    return transaction


# --- Accés -----------------------------------------------------------------


def test_nomes_es_llisten_els_espais_propis(client, db, ledgers):
    user = make_user(db, "sogra@example.com")
    grant(db, user, ledgers["calella"], LedgerRole.VIEWER)
    login(client, "sogra@example.com")

    espais = client.get("/api/workspaces").json()

    assert [(e["code"], e["role"]) for e in espais] == [("calella", "viewer")]


def test_un_espai_alie_es_com_si_no_existis(client, db, comptes, ledgers):
    """404 i no 403: qui no hi te acces no ha de saber ni que l'espai hi es."""
    user = make_user(db, "sogra@example.com")
    grant(db, user, ledgers["calella"])
    login(client, "sogra@example.com")

    for ruta in [
        "/api/workspaces/personal/transactions",
        "/api/workspaces/personal/analytics/dashboard",
        "/api/workspaces/personal/merchants",
        "/api/workspaces/personal/rules",
        "/api/workspaces/personal/categories",
        "/api/workspaces/personal/export/transactions.csv",
    ]:
        assert client.get(ruta).status_code == 404, ruta


def test_ser_administrador_no_dona_acces_als_espais(client, db, ledgers):
    """Qui gestiona bancs i usuaris no veu per defecte la comptabilitat de ningu."""
    make_user(db, "admin@example.com", is_admin=True)
    login(client, "admin@example.com")

    assert client.get("/api/workspaces").json() == []
    assert client.get("/api/workspaces/personal/transactions").status_code == 404


def test_un_lector_no_pot_editar_res(client, db, comptes, ledgers):
    user = make_user(db, "sogra@example.com")
    grant(db, user, ledgers["calella"], LedgerRole.VIEWER)
    login(client, "sogra@example.com")
    transaccio = moviment(db, comptes["calella"])
    supermercat = categoria(db, ledgers["calella"])

    resposta = client.patch(
        f"/api/workspaces/calella/transactions/{transaccio.id}",
        json={"category_id": supermercat.id},
    )

    assert resposta.status_code == 403
    assert client.get("/api/workspaces/calella/transactions").status_code == 200


def test_nomes_qui_gestiona_lespai_en_veu_els_membres(client, db, ledgers):
    user = make_user(db, "parella@example.com")
    grant(db, user, ledgers["pardals"], LedgerRole.EDITOR)
    login(client, "parella@example.com")

    assert client.get("/api/workspaces/pardals/members").status_code == 403


# --- Dades -----------------------------------------------------------------


def test_cada_espai_te_el_seu_pla_de_categories(db, ledgers):
    total = db.scalar(select(func.count(Category.id)))
    per_espai = db.scalar(
        select(func.count(Category.id)).where(Category.ledger_id == ledgers["personal"].id)
    )

    assert per_espai > 50
    assert total == per_espai * 3, "cada espai ha de tenir el seu joc sencer"


def test_els_moviments_dun_espai_no_es_veuen_des_dun_altre(client, db, comptes, ledgers):
    user = make_user(db, "tu@example.com")
    grant_all(db, user, ledgers)
    login(client, "tu@example.com")
    moviment(db, comptes["personal"], "JOAN PUIG", "-500.00")
    moviment(db, comptes["calella"], "MERCADONA", "-30.00")

    personal = client.get("/api/workspaces/personal/transactions").json()
    calella = client.get("/api/workspaces/calella/transactions").json()

    assert [item["normalized_description"] for item in personal["items"]] == ["JOAN PUIG"]
    assert [item["normalized_description"] for item in calella["items"]] == ["MERCADONA"]


def test_els_comercos_no_es_comparteixen_entre_espais(client, db, comptes, ledgers):
    user = make_user(db, "tu@example.com")
    grant_all(db, user, ledgers)
    login(client, "tu@example.com")
    moviment(db, comptes["personal"], "MERCADONA")
    moviment(db, comptes["calella"], "MERCADONA")

    personal = client.get("/api/workspaces/personal/merchants").json()["items"]
    calella = client.get("/api/workspaces/calella/merchants").json()["items"]

    assert len(personal) == 1 and len(calella) == 1
    assert personal[0]["id"] != calella[0]["id"], "son dos comercos diferents"


def test_classificar_a_un_espai_no_toca_laltre(client, db, comptes, ledgers):
    """El mateix comerç a dos espais: confirmar-lo en un no afecta l'altre."""
    user = make_user(db, "tu@example.com")
    grant_all(db, user, ledgers)
    login(client, "tu@example.com")
    a_calella = moviment(db, comptes["calella"], "MERCADONA")
    a_personal = moviment(db, comptes["personal"], "MERCADONA")
    supermercat = categoria(db, ledgers["calella"])

    resposta = client.patch(
        f"/api/workspaces/calella/transactions/{a_calella.id}",
        json={"category_id": supermercat.id, "remember_merchant": True},
    )

    assert resposta.status_code == 200
    db.refresh(a_calella)
    db.refresh(a_personal)
    assert a_calella.category_id == supermercat.id
    assert a_personal.category_id is None, "el mateix comerc a Personal no s'ha de tocar"


def test_no_es_pot_fer_servir_una_categoria_dun_altre_espai(client, db, comptes, ledgers):
    user = make_user(db, "tu@example.com")
    grant_all(db, user, ledgers)
    login(client, "tu@example.com")
    transaccio = moviment(db, comptes["calella"])
    aliena = categoria(db, ledgers["personal"])

    resposta = client.patch(
        f"/api/workspaces/calella/transactions/{transaccio.id}",
        json={"category_id": aliena.id},
    )

    assert resposta.status_code == 400
    assert "no es d'aquest espai" in resposta.json()["detail"]


def test_les_regles_apreses_es_queden_al_seu_espai(client, db, comptes, ledgers):
    user = make_user(db, "tu@example.com")
    grant_all(db, user, ledgers)
    login(client, "tu@example.com")
    transaccio = moviment(db, comptes["calella"])

    client.patch(
        f"/api/workspaces/calella/transactions/{transaccio.id}",
        json={"category_id": categoria(db, ledgers["calella"]).id, "create_rule": True},
    )

    regla = db.scalar(select(Rule).where(Rule.source == RuleSource.LEARNED))
    assert regla is not None
    assert regla.ledger_id == ledgers["calella"].id
    assert client.get("/api/workspaces/personal/rules").json() == []


def test_una_regla_dun_espai_no_classifica_lespai_del_costat(db, comptes, ledgers):
    supermercat = categoria(db, ledgers["calella"])
    db.add(
        Rule(
            name="Mercadona",
            ledger_id=ledgers["calella"].id,
            conditions=[
                {"field": "normalized_description", "operator": "equals", "value": "MERCADONA"}
            ],
            set_category_id=supermercat.id,
        )
    )
    db.flush()
    a_calella = moviment(db, comptes["calella"])
    a_personal = moviment(db, comptes["personal"])

    classify_pending(db, ledgers["calella"].id)
    classify_pending(db, ledgers["personal"].id)

    assert a_calella.category_id == supermercat.id
    assert a_personal.category_id is None
    assert a_personal.category_source is CategorySource.NONE


# --- Diners que passen d'un espai a l'altre --------------------------------


def test_el_que_ve_dun_altre_espai_compta_com_a_ingres(db, comptes, ledgers):
    """Amb espais estancs, uns diners que arriben són una entrada de debò."""
    avui = date.today()
    moviment(db, comptes["personal"], "TRASPAS", "-400.00", avui)
    moviment(db, comptes["calella"], "TRASPAS", "400.00", avui)

    aparellats = detect_transfers(db, ledgers["calella"].id)
    aparellats += detect_transfers(db, ledgers["personal"].id)

    assert aparellats == 0, "entre espais diferents no s'aparella res"
    from app.services.reports import income_and_expenses

    ingressos, _ = income_and_expenses(db, [ledgers["calella"].id], None, None)
    _, despeses = income_and_expenses(db, [ledgers["personal"].id], None, None)
    assert ingressos == Decimal("400.00")
    assert despeses == Decimal("400.00")


def test_dins_dun_mateix_espai_els_traspassos_si_saparellen(db, ledgers, comptes):
    """Dos comptes del mateix espai: moure diners entre ells no és cap despesa."""
    connection = db.scalar(select(BankConnection))
    segon = Account(
        connection_id=connection.id,
        ledger_id=ledgers["personal"].id,
        eb_account_uid="uid-personal-2",
    )
    db.add(segon)
    db.flush()
    avui = date.today()
    sortida = moviment(db, comptes["personal"], "TRASPAS", "-200.00", avui)
    entrada = moviment(db, segon, "TRASPAS", "200.00", avui)

    aparellats = detect_transfers(db, ledgers["personal"].id)

    assert aparellats == 1
    assert sortida.transfer_group_id == entrada.transfer_group_id
