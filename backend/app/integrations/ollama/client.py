"""Client d'Ollama per a la classificacio amb un model local."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import httpx

from app.config import settings
from app.integrations.ollama.prompts import (
    PROMPT_VERSION,
    RESPONSE_SCHEMA,
    SYSTEM_PROMPT,
    MerchantContext,
    build_user_prompt,
)

logger = logging.getLogger(__name__)


class OllamaError(Exception):
    """El model local no ha respost o ha respost malament."""


@dataclass
class Suggestion:
    category_slug: str
    confidence: float
    merchant: str = ""
    rationale: str = ""
    model: str = ""
    prompt_version: str = PROMPT_VERSION


class OllamaClient:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.timeout = timeout or settings.ollama_timeout_seconds
        self._client = httpx.Client(timeout=self.timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> OllamaClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def is_available(self) -> bool:
        """Comprova que el servei respon i que el model hi es."""
        try:
            response = self._client.get(f"{self.base_url}/api/tags", timeout=10)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Ollama no respon a %s: %s", self.base_url, exc)
            return False

        names = {str(item.get("name", "")) for item in response.json().get("models", [])}
        # Les etiquetes poden portar sufix (:latest), aixi que es compara el prefix.
        base = self.model.split(":")[0]
        available = any(name.split(":")[0] == base for name in names)
        if not available:
            logger.warning(
                "El model %s no esta descarregat a Ollama (n'hi ha %s)", self.model, sorted(names)
            )
        return available

    def classify(self, context: MerchantContext, categories: list[tuple[str, str]]) -> Suggestion:
        """Demana la categoria d'un comerc. Llanca OllamaError si falla."""
        payload = {
            "model": self.model,
            "stream": False,
            "format": RESPONSE_SCHEMA,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(context, categories)},
            ],
            "options": {
                # Deterministic: la mateixa entrada ha de donar la mateixa sortida.
                "temperature": 0,
                "num_predict": 200,
            },
        }
        try:
            response = self._client.post(f"{self.base_url}/api/chat", json=payload)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise OllamaError(f"Ollama no ha respost: {exc}") from exc

        content = (response.json().get("message") or {}).get("content", "")
        try:
            data = json.loads(content)
        except (TypeError, ValueError) as exc:
            raise OllamaError(f"Resposta no interpretable: {content[:200]}") from exc

        slug = str(data.get("category_slug") or "").strip()
        if not slug:
            raise OllamaError("La resposta no porta cap categoria")

        try:
            confidence = float(data.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0

        return Suggestion(
            category_slug=slug,
            confidence=max(0.0, min(1.0, confidence)),
            merchant=str(data.get("merchant") or "")[:200],
            rationale=str(data.get("rationale") or "")[:500],
            model=self.model,
        )
