"""Sincronitzacio: importacio, deduplicacio i reconciliacio de pendents."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.integrations.enablebanking.client import DateRangeError, SessionExpiredError
from app.models import Account, Alert, BankConnection, Category, Merchant, Transaction
from app.models.enums import (
    AlertType,
    CategorySource,
    ConnectionStatus,
    SyncStatus,
    TransactionStatus,
)
from app.services.seed import SLUG_UNCATEGORIZED
from app.services.sync import sync_connection
from tests.conftest import login, make_user


class FakeEnableBanking:
    """Client d'Enable Banking simulat, amb el mateix contracte que el real."""

    def __init__(
        self,
        transactions: list[dict] | None = None,
        balances: list[dict] | None = None,
        earliest_accepted: date | None = None,
        raise_expired: bool = False,
    ) -> None:
        self.transactions = transactions or []
        self.balances = balances or []
        self.earliest_accepted = earliest_accepted
        self.raise_expired = raise_expired
        self.requested_windows: list[date] = []
        self.closed = False

    def iter_transactions(self, account_uid, *, date_from, date_to=None, **kwargs):
        self.requested_windows.append(date_from)
        if self.raise_expired:
            raise SessionExpiredError("Session has expired")
        if self.earliest_accepted and date_from < self.earliest_accepted:
            raise DateRangeError("date_from is too far in the past")
        for item in self.transactions:
            if date.fromisoformat(item["booking_date"]) >= date_from:
                yield item

    def get_balances(self, account_uid):
        return self.balances

    def close(self):
        self.closed = True


def moviment(reference, amount, day, status="BOOK", concepte="COMPRA TARJ. EN MERCADONA"):
    return {
        "entry_reference": reference,
        "transaction_amount": {"currency": "EUR", "amount": str(abs(amount))},
        "credit_debit_indicator": "CRDT" if amount > 0 else "DBIT",
        "status": status,
        "booking_date": day.isoformat(),
        "value_date": day.isoformat(),
        "creditor": {"name": "MERCADONA SA"} if amount < 0 else None,
        "remittance_information": [concepte],
    }


@pytest.fixture
def connexio(db, ledgers) -> BankConnection:
    connection = BankConnection(
        name="Santander",
        aspsp_name="Santander",
        aspsp_country="ES",
        eb_session_id="sessio-1",
        status=ConnectionStatus.ACTIVE,
    )
    db.add(connection)
    db.flush()
    db.add(
        Account(
            connection_id=connection.id,
            ledger_id=ledgers["personal"].id,
            eb_account_uid="uid-1",
            name="Compte corrent",
            iban="ES9121000418450200051332",
        )
    )
    db.flush()
    db.refresh(connection)
    return connection


def test_la_primera_sincronitzacio_importa_i_assigna_comerc(db, connexio, ledgers):
    avui = date.today()
    client = FakeEnableBanking(
        transactions=[
            moviment("r1", Decimal("-12.30"), avui - timedelta(days=2)),
            moviment("r2", Decimal("-8.00"), avui - timedelta(days=1)),
        ],
        balances=[
            {
                "balance_amount": {"currency": "EUR", "amount": "500.00"},
                "balance_type": "CLBD",
                "reference_date": avui.isoformat(),
            }
        ],
    )

    result = sync_connection(db, connexio, client=client)

    assert result.inserted == 2
    transactions = list(db.scalars(select(Transaction)))
    assert len(transactions) == 2
    assert {t.ledger_id for t in transactions} == {ledgers["personal"].id}
    merchant = db.scalar(select(Merchant))
    assert merchant is not None and merchant.normalized_name == "MERCADONA SA"
    assert all(t.merchant_id == merchant.id for t in transactions)


def test_sincronitzar_dos_cops_no_duplica_res(db, connexio):
    avui = date.today()
    moviments = [moviment("r1", Decimal("-12.30"), avui - timedelta(days=2))]

    sync_connection(db, connexio, client=FakeEnableBanking(transactions=moviments))
    segona = sync_connection(db, connexio, client=FakeEnableBanking(transactions=moviments))

    assert segona.inserted == 0
    assert segona.updated == 0
    assert db.scalar(select(Transaction).where(Transaction.dedup_key == "ref:r1")) is not None
    assert len(list(db.scalars(select(Transaction)))) == 1


def test_un_pendent_que_es_consolida_conserva_la_categoria(db, connexio, categories):
    avui = date.today()
    sync_connection(
        db,
        connexio,
        client=FakeEnableBanking(
            transactions=[moviment(None, Decimal("-25.00"), avui, status="PDNG")]
        ),
    )
    pendent = db.scalar(select(Transaction))
    assert pendent is not None and pendent.status == TransactionStatus.PENDING
    categoria = db.scalar(select(Category).where(Category.slug == SLUG_UNCATEGORIZED))
    assert categoria is not None
    pendent.category_id = categoria.id
    pendent.category_source = CategorySource.USER
    db.flush()

    # El mateix moviment torna consolidat, amb referencia i un dia mes tard.
    result = sync_connection(
        db,
        connexio,
        client=FakeEnableBanking(
            transactions=[moviment("r9", Decimal("-25.00"), avui + timedelta(days=1))]
        ),
    )

    transactions = list(db.scalars(select(Transaction)))
    assert len(transactions) == 1, "el pendent no s'ha de duplicar en consolidar-se"
    assert result.inserted == 0
    assert transactions[0].status == TransactionStatus.BOOKED
    assert transactions[0].entry_reference == "r9"
    assert transactions[0].category_id == categoria.id
    assert transactions[0].category_source == CategorySource.USER


def test_un_pendent_que_desapareix_sesborra(db, connexio):
    avui = date.today()
    sync_connection(
        db,
        connexio,
        client=FakeEnableBanking(
            transactions=[
                moviment(None, Decimal("-25.00"), avui, status="PDNG"),
                moviment("r1", Decimal("-10.00"), avui),
            ]
        ),
    )
    assert len(list(db.scalars(select(Transaction)))) == 2

    sync_connection(
        db,
        connexio,
        client=FakeEnableBanking(transactions=[moviment("r1", Decimal("-10.00"), avui)]),
    )

    restants = list(db.scalars(select(Transaction)))
    assert [t.entry_reference for t in restants] == ["r1"]


def test_si_el_banc_rebutja_la_finestra_es_va_escurcant(db, connexio):
    avui = date.today()
    limit = avui - timedelta(days=100)
    client = FakeEnableBanking(
        transactions=[moviment("r1", Decimal("-10.00"), avui)], earliest_accepted=limit
    )

    result = sync_connection(db, connexio, client=client)

    assert result.inserted == 1
    assert len(client.requested_windows) > 1
    assert client.requested_windows[-1] >= limit


def test_una_sessio_caducada_marca_la_connexio_i_genera_avis(db, connexio):
    sync_connection(db, connexio, client=FakeEnableBanking(raise_expired=True))

    db.refresh(connexio)
    assert connexio.status == ConnectionStatus.EXPIRED
    alert = db.scalar(select(Alert).where(Alert.type == AlertType.CONSENT_EXPIRED))
    assert alert is not None
    assert "consentiment" in alert.title.lower()


def test_la_sincronitzacio_deixa_traca(db, connexio):
    avui = date.today()
    sync_connection(
        db,
        connexio,
        client=FakeEnableBanking(transactions=[moviment("r1", Decimal("-1.00"), avui)]),
    )

    from app.models import SyncRun

    run = db.scalar(select(SyncRun))
    assert run is not None
    assert run.status == SyncStatus.SUCCESS
    assert run.transactions_inserted == 1
    assert run.finished_at is not None


def test_canviar_el_llibre_dun_compte_arrossega_els_moviments(db, client, connexio, ledgers):
    avui = date.today()
    sync_connection(
        db,
        connexio,
        client=FakeEnableBanking(transactions=[moviment("r1", Decimal("-5.00"), avui)]),
    )
    make_user(db, "admin@example.com", is_admin=True)
    login(client, "admin@example.com")
    account = db.scalar(select(Account))

    response = client.patch(
        f"/api/accounts/{account.id}", json={"ledger_id": ledgers["calella"].id}
    )

    assert response.status_code == 200
    transaction = db.scalar(select(Transaction))
    db.refresh(transaction)
    assert transaction.ledger_id == ledgers["calella"].id
