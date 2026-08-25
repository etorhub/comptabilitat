"""Instruccions per al model local.

Es classifica **per comerc**, no per moviment: en regim normal apareixen molt
pocs comercos nous cada dia, i aixi un NAS sense targeta grafica en te prou.
"""

from __future__ import annotations

from dataclasses import dataclass

# Cal pujar-la quan canvii el text: queda desada a cada suggeriment.
PROMPT_VERSION = "1"

SYSTEM_PROMPT = (
    "Ets un assistent de comptabilitat domestica. Classifiques comercos i "
    "emissors de rebuts espanyols en una categoria d'una llista tancada. "
    "Respons nomes amb JSON valid, sense cap text addicional. "
    "Si no estas segur, tria la categoria mes generica i baixa la confianca."
)

# Esquema que Ollama fa complir a la resposta.
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "category_slug": {"type": "string"},
        "merchant": {"type": "string"},
        "confidence": {"type": "number"},
        "rationale": {"type": "string"},
    },
    "required": ["category_slug", "confidence"],
}


@dataclass
class MerchantContext:
    """El que sap el sistema d'un comerc abans de preguntar al model."""

    normalized_name: str
    sample_descriptions: list[str]
    typical_amount: str
    direction: str  # "despesa" o "ingres"
    occurrences: int


def build_user_prompt(context: MerchantContext, categories: list[tuple[str, str]]) -> str:
    """Munta la pregunta amb la llista de categories permeses."""
    catalog = "\n".join(f"- {slug}: {name}" for slug, name in categories)
    samples = "\n".join(f"  · {text}" for text in context.sample_descriptions[:3])
    return (
        f"Categories permeses (slug: nom):\n{catalog}\n\n"
        f"Comerc a classificar: {context.normalized_name}\n"
        f"Tipus d'operacio: {context.direction}\n"
        f"Import habitual: {context.typical_amount} EUR\n"
        f"Vegades que apareix: {context.occurrences}\n"
        f"Conceptes tal com arriben del banc:\n{samples}\n\n"
        "Respon amb aquest JSON:\n"
        '{"category_slug": "<un slug de la llista>", '
        '"merchant": "<nom net del comerc>", '
        '"confidence": <0.0 a 1.0>, '
        '"rationale": "<justificacio en una frase curta>"}'
    )
