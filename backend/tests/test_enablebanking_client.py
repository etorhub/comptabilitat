"""Client d'Enable Banking: JWT, paginacio i traduccio d'errors."""

from __future__ import annotations

import json
from datetime import date

import httpx
import jwt as pyjwt
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.integrations.enablebanking.client import (
    DateRangeError,
    EnableBankingClient,
    EnableBankingError,
    SessionExpiredError,
)

BASE = "https://api.enablebanking.com"


@pytest.fixture(scope="module")
def private_key() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


@pytest.fixture
def client(private_key: str) -> EnableBankingClient:
    return EnableBankingClient(application_id="app-de-proves", private_key=private_key)


def test_el_jwt_porta_el_kid_i_laudiencia(client: EnableBankingClient):
    token = client._jwt()
    assert pyjwt.get_unverified_header(token)["kid"] == "app-de-proves"
    claims = pyjwt.decode(
        token, options={"verify_signature": False}, audience="api.enablebanking.com"
    )
    assert claims["iss"] == "enablebanking.com"
    assert claims["exp"] - claims["iat"] == 3600


def test_el_jwt_es_reaprofita_mentre_es_valid(client: EnableBankingClient):
    assert client._jwt() == client._jwt()


@respx.mock
def test_els_moviments_segueixen_el_continuation_key(client: EnableBankingClient):
    route = respx.get(f"{BASE}/accounts/abc/transactions")
    route.side_effect = [
        httpx.Response(
            200,
            json={
                "transactions": [{"entry_reference": "1"}, {"entry_reference": "2"}],
                "continuation_key": "seguent",
            },
        ),
        httpx.Response(200, json={"transactions": [{"entry_reference": "3"}]}),
    ]

    items = list(client.iter_transactions("abc", date_from=date(2026, 1, 1)))

    assert [item["entry_reference"] for item in items] == ["1", "2", "3"]
    assert route.call_count == 2
    assert "continuation_key=seguent" in str(route.calls[1].request.url)


@respx.mock
def test_una_sessio_caducada_dona_un_error_propi(client: EnableBankingClient):
    respx.get(f"{BASE}/accounts/abc/balances").mock(
        return_value=httpx.Response(
            401, json={"code": "EXPIRED_SESSION", "message": "Session has expired"}
        )
    )
    with pytest.raises(SessionExpiredError):
        client.get_balances("abc")


@respx.mock
def test_una_finestra_de_dates_rebutjada_dona_un_error_propi(client: EnableBankingClient):
    respx.get(f"{BASE}/accounts/abc/transactions").mock(
        return_value=httpx.Response(
            400, json={"message": "date_from is too far in the past", "code": "WRONG_REQUEST"}
        )
    )
    with pytest.raises(DateRangeError):
        list(client.iter_transactions("abc", date_from=date(2000, 1, 1)))


@respx.mock
def test_la_resta_derrors_es_propaguen(client: EnableBankingClient):
    respx.get(f"{BASE}/aspsps").mock(return_value=httpx.Response(500, json={"message": "uf"}))
    with pytest.raises(EnableBankingError) as excinfo:
        client.list_aspsps()
    assert excinfo.value.status_code == 500


@respx.mock
def test_lautoritzacio_demana_la_validesa_del_consentiment(client: EnableBankingClient):
    route = respx.post(f"{BASE}/auth").mock(
        return_value=httpx.Response(200, json={"url": "https://banc.example/sca"})
    )
    payload = client.start_authorization(
        aspsp_name="Santander",
        aspsp_country="ES",
        redirect_url="https://comptes.example/api/auth/callback",
        state="estat-123",
        valid_days=90,
    )
    assert payload["url"] == "https://banc.example/sca"
    body = json.loads(respx.calls[0].request.content)
    assert body["state"] == "estat-123"
    assert body["aspsp"] == {"name": "Santander", "country": "ES"}
    assert body["access"]["valid_until"].endswith("Z")
    assert route.called
