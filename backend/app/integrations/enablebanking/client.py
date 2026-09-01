"""Client de l'API d'Enable Banking.

L'autenticacio es fa amb un JWT signat amb RS256 amb la clau privada de
l'aplicacio registrada al panell de control d'Enable Banking. El `kid` de la
capcalera es l'identificador de l'aplicacio.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import jwt as pyjwt

from app.config import settings

logger = logging.getLogger(__name__)

JWT_TTL_SECONDS = 3600
# Marge per no fer servir un testimoni just abans que caduqui.
JWT_REFRESH_MARGIN = 120


class EnableBankingError(Exception):
    """Error retornat per l'API d'Enable Banking."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        code: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.payload = payload or {}


class SessionExpiredError(EnableBankingError):
    """El consentiment ha caducat: cal tornar a autoritzar amb SCA."""


class DateRangeError(EnableBankingError):
    """El banc no accepta la finestra de dates demanada."""


class MissingCredentialsError(EnableBankingError):
    """Falta l'identificador d'aplicacio o la clau privada."""


def _load_private_key() -> str:
    """Llegeix la clau privada del secret muntat o de la variable d'entorn."""
    key = settings.resolved_eb_private_key
    if key:
        return key
    raise MissingCredentialsError(
        f"No s'ha trobat la clau privada d'Enable Banking a {settings.eb_private_key_path}. "
        "Comprova EB_PRIVATE_KEY, EB_PRIVATE_KEY_B64 o el secret eb_private_key del stack."
    )


def _iso_z(value: datetime) -> str:
    """Enable Banking espera marques de temps UTC amb sufix Z."""
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class EnableBankingClient:
    def __init__(
        self,
        application_id: str | None = None,
        private_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.application_id = application_id or settings.eb_application_id
        self._private_key = private_key
        self.base_url = (base_url or settings.eb_api_origin).rstrip("/")
        self._client = httpx.Client(timeout=timeout)
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    # --- Infraestructura ---------------------------------------------------

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> EnableBankingClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    @property
    def private_key(self) -> str:
        if self._private_key is None:
            self._private_key = _load_private_key()
        return self._private_key

    def _jwt(self) -> str:
        now = time.time()
        if self._token and now < self._token_expires_at - JWT_REFRESH_MARGIN:
            return self._token
        if not self.application_id:
            raise MissingCredentialsError("Falta EB_APPLICATION_ID")
        issued_at = int(now)
        self._token = pyjwt.encode(
            {
                "iss": "enablebanking.com",
                "aud": "api.enablebanking.com",
                "iat": issued_at,
                "exp": issued_at + JWT_TTL_SECONDS,
            },
            self.private_key,
            algorithm="RS256",
            headers={"kid": self.application_id},
        )
        self._token_expires_at = issued_at + JWT_TTL_SECONDS
        return self._token

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        clean_params = {k: v for k, v in (params or {}).items() if v is not None}
        response = self._client.request(
            method,
            url,
            params=clean_params or None,
            json=json,
            headers={"Authorization": f"Bearer {self._jwt()}"},
        )
        if response.status_code >= 400:
            raise self._to_error(response)
        if not response.content:
            return {}
        return response.json()

    @staticmethod
    def _to_error(response: httpx.Response) -> EnableBankingError:
        try:
            payload = response.json()
        except ValueError:
            payload = {"message": response.text}
        message = payload.get("message") or payload.get("error") or response.text
        code = payload.get("code") or payload.get("error")
        text = f"{code or ''} {message or ''}".upper()

        if "EXPIRED_SESSION" in text or "SESSION_EXPIRED" in text:
            return SessionExpiredError(
                str(message), status_code=response.status_code, code=str(code), payload=payload
            )
        # Els bancs limiten quant enrere es pot consultar; el missatge varia molt,
        # aixi que ens quedem amb les paraules que hi apareixen sempre.
        if response.status_code in (400, 422) and any(
            word in text for word in ("DATE", "PERIOD", "RANGE", "FROM")
        ):
            return DateRangeError(
                str(message), status_code=response.status_code, code=str(code), payload=payload
            )
        return EnableBankingError(
            str(message), status_code=response.status_code, code=str(code), payload=payload
        )

    # --- Endpoints ---------------------------------------------------------

    def get_application(self) -> dict[str, Any]:
        """Dades de l'aplicacio registrada. Util per comprovar les credencials."""
        return self._request("GET", "/application")

    def list_aspsps(self, country: str | None = None) -> list[dict[str, Any]]:
        payload = self._request("GET", "/aspsps", params={"country": country})
        return payload.get("aspsps", [])

    def start_authorization(
        self,
        *,
        aspsp_name: str,
        aspsp_country: str,
        redirect_url: str,
        state: str,
        psu_type: str = "personal",
        valid_days: int | None = None,
    ) -> dict[str, Any]:
        """Inicia l'autoritzacio i retorna la URL on ha d'anar l'usuari."""
        days = valid_days or settings.eb_consent_days
        body = {
            "access": {"valid_until": _iso_z(datetime.now(UTC) + timedelta(days=days))},
            "aspsp": {"name": aspsp_name, "country": aspsp_country},
            "state": state,
            "redirect_url": redirect_url,
            "psu_type": psu_type,
        }
        return self._request("POST", "/auth", json=body)

    def create_session(self, code: str) -> dict[str, Any]:
        """Bescanvia el codi del retorn del banc per una sessio amb els comptes."""
        return self._request("POST", "/sessions", json={"code": code})

    def get_session(self, session_id: str) -> dict[str, Any]:
        return self._request("GET", f"/sessions/{session_id}")

    def delete_session(self, session_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/sessions/{session_id}")

    def get_account_details(self, account_uid: str) -> dict[str, Any]:
        return self._request("GET", f"/accounts/{account_uid}/details")

    def get_balances(self, account_uid: str) -> list[dict[str, Any]]:
        payload = self._request("GET", f"/accounts/{account_uid}/balances")
        return payload.get("balances", [])

    def iter_transactions(
        self,
        account_uid: str,
        *,
        date_from: date,
        date_to: date | None = None,
        transaction_status: str | None = None,
        max_pages: int = 200,
    ) -> Iterator[dict[str, Any]]:
        """Recorre els moviments seguint el `continuation_key` de cada pagina."""
        continuation_key: str | None = None
        for page in range(max_pages):
            payload = self._request(
                "GET",
                f"/accounts/{account_uid}/transactions",
                params={
                    "date_from": date_from.isoformat(),
                    "date_to": date_to.isoformat() if date_to else None,
                    "transaction_status": transaction_status,
                    "continuation_key": continuation_key,
                },
            )
            transactions = payload.get("transactions", [])
            yield from transactions
            continuation_key = payload.get("continuation_key")
            if not continuation_key:
                return
            logger.debug(
                "Compte %s: pagina %s amb %s moviments, continuem",
                account_uid,
                page + 1,
                len(transactions),
            )
        logger.warning(
            "Compte %s: s'ha arribat al limit de %s pagines de moviments",
            account_uid,
            max_pages,
        )
