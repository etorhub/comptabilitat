"""Recurrents, previsio de saldo i avisos de descobert."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import (
    Account,
    Alert,
    Balance,
    BankConnection,
    RecurringSeries,
    Transaction,
)
from app.models.enums import (
    AlertType,
    Cadence,
    ConnectionStatus,
    SeriesStatus,
    TransactionStatus,
)
from app.services.forecast import build_forecast, check_overdrafts, daily_discretionary_spend
from app.services.recurring import check_missing_occurrences, detect_recurring
from tests.conftest import grant, login, make_user


@pytest.fixture
def compte(db, ledgers) -> Account:
    connection = BankConnection(
        aspsp_name="Santander", aspsp_country="ES", status=ConnectionStatus.ACTIVE
    )
    db.add(connection)
    db.flush()
    account = Account(
        connection_id=connection.id, ledger_id=ledgers["personal"].id, eb_account_uid="uid-1"
    )
    db.add(account)
    db.flush()
    return account


def moviment(db, compte, amount, day, description="RECIBO NETFLIX", normalized="NETFLIX"):
    transaction = Transaction(
        account_id=compte.id,
        ledger_id=compte.ledger_id,
        dedup_key=f"k-{description}-{day}-{amount}",
        booking_date=day,
        amount=Decimal(str(amount)),
        description=description,
        normalized_description=normalized,
        status=TransactionStatus.BOOKED,
    )
    db.add(transaction)
    db.flush()
    return transaction


def saldo(db, compte, amount, day=None):
    from app.core.time import utcnow

    db.add(
        Balance(
            account_id=compte.id,
            balance_type="CLBD",
            amount=Decimal(str(amount)),
            reference_date=day or date.today(),
            fetched_at=utcnow(),
        )
    )
    db.flush()


def test_es_detecta_una_subscripcio_mensual(db, compte, ledgers):
    avui = date.today()
    for index in range(6):
        moviment(db, compte, "-12.99", avui - timedelta(days=30 * (5 - index)))

    stats = detect_recurring(db)

    assert stats.created == 1
    series = db.scalar(select(RecurringSeries))
    assert series is not None
    assert series.cadence is Cadence.MONTHLY
    assert series.expected_amount == Decimal("-12.99")
    assert series.is_subscription is True
    assert series.occurrences_count == 6
    assert series.next_expected_date == avui + timedelta(days=30)
    assert series.confidence >= 0.9


def test_els_moviments_irregulars_no_son_una_serie(db, compte, ledgers):
    avui = date.today()
    for offset in (0, 3, 40, 41, 95):
        moviment(db, compte, "-20.00", avui - timedelta(days=offset), normalized="BAR DE SOTA")

    detect_recurring(db)

    assert db.scalar(select(RecurringSeries)) is None


def test_calen_com_a_minim_tres_aparicions(db, compte, ledgers):
    avui = date.today()
    moviment(db, compte, "-12.99", avui - timedelta(days=30))
    moviment(db, compte, "-12.99", avui)

    detect_recurring(db)

    assert db.scalar(select(RecurringSeries)) is None


def test_una_pujada_dimport_genera_avis(db, compte, ledgers):
    avui = date.today()
    for index in range(5):
        moviment(db, compte, "-12.99", avui - timedelta(days=30 * (5 - index)))
    detect_recurring(db)

    # Arriba el rebut seguent, mes car del compte.
    moviment(db, compte, "-17.99", avui + timedelta(days=30))
    stats = detect_recurring(db)

    assert stats.alerts == 1
    alert = db.scalar(select(Alert).where(Alert.type == AlertType.RECURRING_AMOUNT_CHANGE))
    assert alert is not None
    assert "puja" in alert.title


def test_un_rebut_que_no_arriba_genera_avis(db, compte, ledgers):
    avui = date.today()
    for index in range(4):
        moviment(db, compte, "-12.99", avui - timedelta(days=30 * (4 - index) + 10))
    detect_recurring(db)
    series = db.scalar(select(RecurringSeries))
    series.next_expected_date = avui - timedelta(days=10)
    db.flush()

    created = check_missing_occurrences(db)

    assert created == 1
    alert = db.scalar(select(Alert).where(Alert.type == AlertType.RECURRING_MISSING))
    assert alert is not None


def test_la_despesa_variable_ignora_els_rebuts_recurrents(db, compte, ledgers):
    avui = date.today()
    for index in range(4):
        moviment(db, compte, "-30.00", avui - timedelta(days=30 * index))
    detect_recurring(db)
    # Despesa solta que si que compta.
    moviment(db, compte, "-90.00", avui - timedelta(days=5), description="COMPRA", normalized="BAR")

    diaria = daily_discretionary_spend(db, ledgers["personal"].id)

    assert diaria == Decimal("1.00"), "90 EUR repartits en 90 dies"


def test_la_previsio_incorpora_els_rebuts_previstos(db, compte, ledgers):
    avui = date.today()
    saldo(db, compte, "1000.00")
    for index in range(6):
        moviment(db, compte, "-100.00", avui - timedelta(days=30 * (5 - index)))
    detect_recurring(db)

    forecast = build_forecast(db, ledgers["personal"], horizon_days=90)

    assert forecast.starting_balance == Decimal("1000.00")
    assert len(forecast.points) == 91
    assert len(forecast.events) == 3, "tres rebuts mensuals en 90 dies"
    assert forecast.points[-1].expected < forecast.starting_balance
    # La banda pessimista ha de quedar sempre per sota de l'esperada.
    assert forecast.points[-1].pessimistic <= forecast.points[-1].expected


def test_es_detecta_un_descobert_futur(db, compte, ledgers):
    avui = date.today()
    saldo(db, compte, "150.00")
    for index in range(6):
        moviment(db, compte, "-100.00", avui - timedelta(days=30 * (5 - index)))
    detect_recurring(db)

    created = check_overdrafts(db)

    assert created >= 1
    alert = db.scalar(select(Alert).where(Alert.type == AlertType.PROJECTED_OVERDRAFT))
    assert alert is not None
    assert "descobert" in alert.title
    assert alert.payload["ledger_id"] == ledgers["personal"].id


def test_sense_perill_no_hi_ha_avis(db, compte, ledgers):
    avui = date.today()
    saldo(db, compte, "50000.00")
    for index in range(6):
        moviment(db, compte, "-100.00", avui - timedelta(days=30 * (5 - index)))
    detect_recurring(db)

    assert check_overdrafts(db) == 0


def test_una_serie_exclosa_no_entra_a_la_previsio(db, compte, ledgers):
    avui = date.today()
    saldo(db, compte, "1000.00")
    for index in range(6):
        moviment(db, compte, "-100.00", avui - timedelta(days=30 * (5 - index)))
    detect_recurring(db)
    series = db.scalar(select(RecurringSeries))
    series.include_in_forecast = False
    db.flush()

    forecast = build_forecast(db, ledgers["personal"], horizon_days=90)

    assert forecast.events == []


def test_lapi_de_previsio_respecta_els_permisos(client, db, compte, ledgers):
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")
    saldo(db, compte, "1000.00")

    assert client.get(f"/api/analytics/forecast/{ledgers['personal'].id}").status_code == 200
    assert client.get(f"/api/analytics/forecast/{ledgers['calella'].id}").status_code == 403


def test_el_resum_de_subscripcions_suma_el_cost_mensual(client, db, compte, ledgers):
    avui = date.today()
    for index in range(6):
        moviment(db, compte, "-12.00", avui - timedelta(days=30 * (5 - index)))
    detect_recurring(db)
    user = make_user(db, "anna@example.com")
    grant(db, user, ledgers["personal"])
    login(client, "anna@example.com")

    body = client.get("/api/recurring/summary").json()

    assert Decimal(body["mensual"]) == Decimal("12.00")
    assert Decimal(body["anual"]) == Decimal("144.00")


def test_una_serie_molt_endarrerida_es_dona_per_acabada(db, compte, ledgers):
    avui = date.today()
    for index in range(4):
        moviment(db, compte, "-12.99", avui - timedelta(days=30 * (6 - index)))
    detect_recurring(db)
    series = db.scalar(select(RecurringSeries))
    series.next_expected_date = avui - timedelta(days=90)
    db.flush()

    check_missing_occurrences(db)

    db.refresh(series)
    assert series.status is SeriesStatus.ENDED
