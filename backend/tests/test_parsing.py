"""Conversio dels moviments d'Enable Banking."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.integrations.enablebanking.parsing import (
    parse_account,
    parse_balance,
    parse_transaction,
)
from app.models.enums import TransactionStatus


def moviment(**overrides) -> dict:
    base = {
        "entry_reference": "REF-1",
        "transaction_amount": {"currency": "EUR", "amount": "42.50"},
        "credit_debit_indicator": "DBIT",
        "status": "BOOK",
        "booking_date": "2026-08-12",
        "value_date": "2026-08-13",
        "creditor": {"name": "MERCADONA SA"},
        "remittance_information": ["COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA"],
        "bank_transaction_code": {"code": "PMNT", "sub_code": "CCRD"},
    }
    base.update(overrides)
    return base


def test_una_despesa_es_desa_amb_signe_negatiu():
    parsed = parse_transaction(moviment())
    assert parsed is not None
    assert parsed.amount == Decimal("-42.50")
    assert parsed.status == TransactionStatus.BOOKED
    assert parsed.booking_date == date(2026, 8, 12)
    assert parsed.counterparty == "MERCADONA SA"
    assert parsed.bank_transaction_code == "PMNT/CCRD"


def test_un_ingres_es_desa_amb_signe_positiu():
    parsed = parse_transaction(
        moviment(credit_debit_indicator="CRDT", debtor={"name": "EMPRESA SL"}, creditor=None)
    )
    assert parsed is not None
    assert parsed.amount == Decimal("42.50")
    assert parsed.counterparty == "EMPRESA SL"


def test_un_moviment_pendent_es_marca_com_a_pendent():
    parsed = parse_transaction(moviment(status="PDNG"))
    assert parsed is not None
    assert parsed.status == TransactionStatus.PENDING


def test_els_moviments_rebutjats_sigonoren():
    assert parse_transaction(moviment(status="RJCT")) is None


def test_sense_data_no_es_pot_desar():
    assert (
        parse_transaction(moviment(booking_date=None, value_date=None, transaction_date=None))
        is None
    )


def test_la_clau_de_deduplicacio_es_la_referencia_quan_nhi_ha():
    parsed = parse_transaction(moviment())
    assert parsed is not None
    assert parsed.dedup_key() == "ref:REF-1"


def test_sense_referencia_la_clau_es_estable_i_diferencia_els_imports():
    primer = parse_transaction(moviment(entry_reference=None))
    segon = parse_transaction(moviment(entry_reference=None))
    altre = parse_transaction(
        moviment(entry_reference=None, transaction_amount={"currency": "EUR", "amount": "42.51"})
    )
    assert primer is not None and segon is not None and altre is not None
    assert primer.dedup_key() == segon.dedup_key()
    assert primer.dedup_key() != altre.dedup_key()
    assert primer.dedup_key().startswith("h:")


def test_la_descripcio_ajunta_concepte_i_contrapart_sense_repetir():
    parsed = parse_transaction(moviment())
    assert parsed is not None
    assert "MERCADONA" in parsed.description
    assert parsed.description.count("MERCADONA SA") == 1


def test_el_compte_pren_liban_de_lidentificador():
    account = parse_account(
        {
            "uid": "uid-1",
            "name": "Compte nomina",
            "account_id": {"iban": "ES9121000418450200051332"},
            "currency": "EUR",
            "cash_account_type": "CACC",
        }
    )
    assert account["eb_account_uid"] == "uid-1"
    assert account["iban"] == "ES9121000418450200051332"


def test_el_compte_cau_a_all_account_ids_si_cal():
    account = parse_account(
        {
            "uid": "uid-2",
            "all_account_ids": [{"scheme_name": "IBAN", "identification": "ES76..."}],
        }
    )
    assert account["iban"] == "ES76..."


def test_els_saldos_es_converteixen_amb_data():
    balance = parse_balance(
        {
            "balance_amount": {"currency": "EUR", "amount": "1234.56"},
            "balance_type": "CLBD",
            "reference_date": "2026-08-20",
        }
    )
    assert balance is not None
    assert balance["amount"] == Decimal("1234.56")
    assert balance["reference_date"] == date(2026, 8, 20)
