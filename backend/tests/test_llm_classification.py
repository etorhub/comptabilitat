"""Classificacio amb el model local."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import httpx
import pytest
import respx
from sqlalchemy import select

from app.config import settings
from app.integrations.ollama.client import OllamaClient, OllamaError, Suggestion
from app.integrations.ollama.prompts import MerchantContext
from app.models import Account, BankConnection, Category, LlmSuggestion, Merchant, Transaction
from app.models.enums import CategorySource, ConnectionStatus, TransactionStatus
from app.services.llm_classification import categories_catalog, classify_merchants

BASE = "http://ollama:11434"


class FakeOllama:
    """Model local simulat, amb el mateix contracte que el client real."""

    def __init__(self, responses=None, available=True, raise_error=False):
        self.responses = responses or {}
        self.available = available
        self.raise_error = raise_error
        self.asked: list[str] = []

    def is_available(self):
        return self.available

    def classify(self, context: MerchantContext, categories):
        self.asked.append(context.normalized_name)
        if self.raise_error:
            raise OllamaError("no respon")
        return self.responses[context.normalized_name]

    def close(self):
        pass


@pytest.fixture(autouse=True)
def activa_el_model(monkeypatch):
    monkeypatch.setattr(settings, "ollama_enabled", True)
    monkeypatch.setattr(settings, "ollama_min_confidence", 0.55)


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
    account = Account(
        connection_id=connection.id,
        ledger_id=espai.id,
        eb_account_uid="uid-1",
    )
    db.add(account)
    db.flush()
    return account


def comerc_amb_moviment(db, compte, nom, amount="-30.00") -> Merchant:
    merchant = Merchant(
        ledger_id=compte.ledger_id, normalized_name=nom, display_name=nom.capitalize()
    )
    db.add(merchant)
    db.flush()
    db.add(
        Transaction(
            account_id=compte.id,
            ledger_id=compte.ledger_id,
            dedup_key=f"k-{nom}",
            booking_date=date.today(),
            amount=Decimal(amount),
            description=f"COMPRA EN {nom}",
            normalized_description=nom,
            merchant_id=merchant.id,
            status=TransactionStatus.BOOKED,
        )
    )
    db.flush()
    return merchant


def test_el_cataleg_nomes_porta_categories_fulla(db, espai, categories):
    catalog = categories_catalog(db, espai.id)
    slugs = {slug for slug, _ in catalog}

    assert "habitatge-lloguer-o-hipoteca" in slugs
    assert "habitatge" not in slugs, "els pares no son opcions valides"
    assert all(">" in name or "-" not in slug for slug, name in catalog)
    # Els traspassos no els decideix el model.
    assert not any(slug.startswith("traspassos") for slug in slugs)


def test_un_suggeriment_amb_confianca_alta_sapliica_pero_queda_per_revisar(
    db, compte, espai, categories
):
    merchant = comerc_amb_moviment(db, compte, "MERCADONA")
    supermercat = db.scalar(
        select(Category).where(
            Category.ledger_id == espai.id, Category.slug == "alimentacio-supermercat"
        )
    )
    client = FakeOllama(
        {
            "Mercadona": Suggestion(
                category_slug="alimentacio-supermercat",
                confidence=0.9,
                merchant="Mercadona",
                rationale="Cadena de supermercats",
                model="model-de-proves",
            )
        }
    )

    stats = classify_merchants(db, espai.id, client=client)

    assert stats.classified == 1
    db.refresh(merchant)
    assert merchant.default_category_id == supermercat.id
    assert merchant.category_source is CategorySource.LLM
    assert merchant.is_confirmed is False, "el model no confirma res per ell mateix"

    transaction = db.scalar(select(Transaction))
    assert transaction.category_id == supermercat.id
    assert transaction.category_source is CategorySource.LLM
    assert transaction.needs_review is True


def test_un_suggeriment_amb_poca_confianca_no_sapliica(db, compte, espai, categories):
    merchant = comerc_amb_moviment(db, compte, "COSA RARA")
    client = FakeOllama(
        {
            "Cosa rara": Suggestion(
                category_slug="alimentacio-supermercat", confidence=0.2, model="m"
            )
        }
    )

    stats = classify_merchants(db, espai.id, client=client)

    assert stats.low_confidence == 1
    db.refresh(merchant)
    assert merchant.default_category_id is None
    # Pero el suggeriment queda desat per poder-lo consultar a la revisio.
    assert db.scalar(select(LlmSuggestion)) is not None


def test_una_categoria_inventada_no_sacepta(db, compte, espai, categories):
    merchant = comerc_amb_moviment(db, compte, "MERCADONA")
    client = FakeOllama(
        {"Mercadona": Suggestion(category_slug="categoria-inventada", confidence=0.99, model="m")}
    )

    stats = classify_merchants(db, espai.id, client=client)

    assert stats.failed == 1
    db.refresh(merchant)
    assert merchant.default_category_id is None


def test_els_comercos_ja_confirmats_no_es_tornen_a_mirar(db, compte, espai, categories):
    merchant = comerc_amb_moviment(db, compte, "MERCADONA")
    supermercat = db.scalar(
        select(Category).where(
            Category.ledger_id == espai.id, Category.slug == "alimentacio-supermercat"
        )
    )
    merchant.default_category_id = supermercat.id
    merchant.is_confirmed = True
    db.flush()
    client = FakeOllama({})

    stats = classify_merchants(db, espai.id, client=client)

    assert client.asked == []
    assert "no hi ha cap comerc nou" in stats.skipped


def test_si_el_model_no_esta_disponible_no_es_trenca_res(db, compte, espai, categories):
    comerc_amb_moviment(db, compte, "MERCADONA")

    stats = classify_merchants(db, espai.id, client=FakeOllama(available=False))

    assert "no esta disponible" in stats.skipped
    assert db.scalar(select(Transaction)).category_id is None


def test_un_error_del_model_no_atura_la_resta(db, compte, espai, categories):
    comerc_amb_moviment(db, compte, "MERCADONA")
    comerc_amb_moviment(db, compte, "NETFLIX", amount="-12.99")

    stats = classify_merchants(db, espai.id, client=FakeOllama(raise_error=True))

    assert stats.examined == 2
    assert stats.failed == 2


def test_amb_el_model_desactivat_no_es_fa_res(db, compte, espai, categories, monkeypatch):
    monkeypatch.setattr(settings, "ollama_enabled", False)
    comerc_amb_moviment(db, compte, "MERCADONA")

    stats = classify_merchants(db, espai.id, client=FakeOllama())

    assert "desactivat" in stats.skipped


@respx.mock
def test_el_client_interpreta_la_resposta_dollama():
    respx.get(f"{BASE}/api/tags").mock(
        return_value=httpx.Response(200, json={"models": [{"name": "qwen3:4b"}]})
    )
    respx.post(f"{BASE}/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {
                    "content": (
                        '{"category_slug": "alimentacio-supermercat", "merchant": "Mercadona",'
                        ' "confidence": 0.87, "rationale": "supermercat"}'
                    )
                }
            },
        )
    )
    client = OllamaClient(base_url=BASE, model="qwen3:4b")

    assert client.is_available() is True
    suggestion = client.classify(
        MerchantContext("Mercadona", ["COMPRA EN MERCADONA"], "30.00", "despesa", 4),
        [("alimentacio-supermercat", "Alimentacio > Supermercat")],
    )

    assert suggestion.category_slug == "alimentacio-supermercat"
    assert suggestion.confidence == 0.87
    assert suggestion.model == "qwen3:4b"


@respx.mock
def test_una_resposta_illegible_dona_error():
    respx.post(f"{BASE}/api/chat").mock(
        return_value=httpx.Response(200, json={"message": {"content": "no soc json"}})
    )
    client = OllamaClient(base_url=BASE, model="qwen3:4b")

    with pytest.raises(OllamaError):
        client.classify(MerchantContext("X", [], "1.00", "despesa", 1), [("slug", "Nom")])


@respx.mock
def test_si_falta_el_model_no_es_dona_per_disponible():
    respx.get(f"{BASE}/api/tags").mock(
        return_value=httpx.Response(200, json={"models": [{"name": "llama3.2:3b"}]})
    )
    assert OllamaClient(base_url=BASE, model="qwen3:4b").is_available() is False
