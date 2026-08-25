"""Neteja dels conceptes bancaris per obtenir el nom del comerc.

Els conceptes del Santander arriben amb molt de soroll: tipus d'operacio,
digits de la targeta, dates, poblacio i referencies internes. Aixo ho redueix a
un nom estable que serveix de clau de la memoria de comercos.
"""

from __future__ import annotations

import re
import unicodedata

# Prefixos que descriuen el tipus d'operacio i no el comerc.
PREFIX_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p)
    for p in (
        r"^COMPRA\s+(?:CON\s+)?TARJ(?:ETA)?\.?\s*(?:DE\s+CREDITO|DE\s+DEBITO)?\s*",
        r"^PAGO\s+(?:MOVIL|CON\s+MOVIL|TARJETA|EN)\s*(?:EN\s+)?",
        r"^COMPRA\s+EN\s+",
        r"^COMPRA\s+",
        r"^ADEUDO\s+(?:POR\s+)?DOMICILIACION(?:\s+DE)?\s*",
        r"^ADEUDO\s+",
        r"^RECIBO\s+(?:DE\s+)?",
        r"^TRANSFERENCIA\s+(?:RECIBIDA\s+)?(?:DE|A|A\s+FAVOR\s+DE|EMITIDA\s+A)?\s*",
        r"^TRANSF\.?\s+(?:DE|A)?\s*",
        r"^BIZUM\s+(?:DE|A|RECIBIDO\s+DE|ENVIADO\s+A)?\s*",
        r"^ENVIO\s+BIZUM\s+A?\s*",
        r"^TRASPASO\s+(?:DE|A)?\s*",
        r"^INGRESO\s+(?:DE|EN\s+EFECTIVO|POR)?\s*",
        r"^NOMINA\s+(?:DE|MES)?\s*",
        r"^PENSION\s+(?:DE)?\s*",
        r"^REINTEGRO\s+(?:EN\s+)?(?:CAJERO|OFICINA)?\s*",
        r"^DISPOSICION\s+(?:DE\s+)?EFECTIVO\s*",
        r"^COMISION\s+(?:DE\s+)?",
        r"^LIQUIDACION\s+(?:DE\s+)?",
        r"^PAGO\s+RECIBO\s+",
        r"^DEVOLUCION\s+(?:DE\s+)?",
        r"^ABONO\s+(?:DE\s+)?",
        r"^CARGO\s+(?:DE\s+)?",
    )
]

# Soroll que pot apareixer en qualsevol posicio del concepte.
NOISE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Numeros de targeta emmascarats: 5402XXXXXXXX1234, 1234******5678
    (re.compile(r"\b\d{2,6}[X\*]{3,}\d{2,6}\b", re.IGNORECASE), " "),
    (re.compile(r"\b[X\*]{4,}\d{2,6}\b", re.IGNORECASE), " "),
    # Dates i hores
    (re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b"), " "),
    (re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"), " "),
    # Referencies llargues i identificadors
    (re.compile(r"\b[A-Z]{0,3}\d{8,}\b"), " "),
    (re.compile(r"\bREF\.?\s*[:\-]?\s*\w*", re.IGNORECASE), " "),
    (re.compile(r"\bMANDATO\s*[:\-]?\s*\w+", re.IGNORECASE), " "),
    (re.compile(r"\bCONCEPTO\s*[:\-]?", re.IGNORECASE), " "),
    # NIF/CIF espanyols
    (re.compile(r"\b[A-Z]\d{7}[A-Z0-9]\b"), " "),
    (re.compile(r"\b\d{8}[A-Z]\b"), " "),
    # IBAN
    (re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b"), " "),
    # Restes de puntuacio i separadors
    (re.compile(r"[·|;]+"), " "),
    (re.compile(r"\s*[-_]{2,}\s*"), " "),
]

# A partir d'aquestes paraules, la resta del concepte es referencia interna.
TRUNCATE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE)
    for p in (r"\bCONCEPTO\b", r"\bREF\.?\b", r"\bMANDATO\b", r"\bN\.?\s?ORDEN\b")
]

# Operacions que no tenen comerc: es normalitzen a un nom fix i reconeixible.
SPECIAL_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(REINTEGRO|DISPOSICION\s+DE\s+EFECTIVO|CAJERO)\b"), "REINTEGRO EFECTIU"),
    (re.compile(r"\bCOMISION\b"), "COMISSIO BANCARIA"),
    (re.compile(r"\bTRASPASO\b"), "TRASPAS ENTRE COMPTES"),
]

# Preposicions que queden penjades al davant despres de treure el prefix.
LEADING_STOPWORDS = {"EN", "A", "DE", "DEL", "LA", "EL", "POR", "PARA", "FAVOR"}

# Els mesos apareixen en nomines i rebuts i no identifiquen res.
MONTHS = {
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
    "GENER",
    "FEBRER",
    "MARC",
    "MAIG",
    "JUNY",
    "JULIOL",
    "AGOST",
    "SETEMBRE",
    "NOVEMBRE",
    "DESEMBRE",
}

# Sigles societaries que es deixen en majuscules encara que siguin llargues.
COMPANY_SUFFIXES = {"SA", "SL", "SLU", "SAU", "SARL", "SCP", "SCCL", "SAS", "BV", "GMBH", "LTD"}

# Enllaços que dins d'un nom van en minuscula.
CONNECTORS = {"DE", "DEL", "DELS", "LA", "LES", "EL", "ELS", "I", "Y", "D'", "DA", "DO", "EN"}

# Paraules curtes que son paraules de debo, no sigles: «Bar», no «BAR».
SHORT_WORDS = {"BAR", "CAL", "CAN", "MAS", "MAR", "SOL", "VIA", "PAN", "SUD", "RIU", "CASA"}

# Paraules finals que solen ser la poblacio o dades del terminal.
TRAILING_NOISE = {
    "ES",
    "ESP",
    "ESPANA",
    "TARJ",
    "TARJETA",
    "COMERCIO",
    "TERMINAL",
    "OFICINA",
    "SUCURSAL",
}


def strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(char for char in normalized if not unicodedata.combining(char))


def normalize_description(description: str, counterparty: str = "") -> tuple[str, str]:
    """Retorna (clau normalitzada, nom per mostrar).

    La clau es en majuscules i sense accents, apta per agrupar. El nom per
    mostrar es el mateix text amb una capitalitzacio llegible.
    """
    # Si el banc ja dona la contrapart, es molt mes fiable que el concepte lliure.
    source = counterparty.strip() or description.strip()
    if not source:
        return "", ""

    text = strip_accents(source).upper()

    # Les operacions sense comerc es resolen abans de res.
    if not counterparty.strip():
        for pattern, label in SPECIAL_PATTERNS:
            if pattern.search(text):
                return label, display_name(label)

    for pattern in PREFIX_PATTERNS:
        replaced = pattern.sub("", text, count=1)
        if replaced != text:
            text = replaced
            # Amb un prefix conegut, el que va despres d'una coma sol ser la poblacio.
            text = text.split(",")[0]
            break

    for pattern in TRUNCATE_PATTERNS:
        if match := pattern.search(text):
            text = text[: match.start()]

    for pattern, replacement in NOISE_PATTERNS:
        text = pattern.sub(replacement, text)

    text = re.sub(r"[^A-Z0-9&'\.\s]", " ", text)
    tokens = [token for token in text.split() if token]

    while tokens and (tokens[-1] in TRAILING_NOISE or tokens[-1].isdigit()):
        tokens.pop()
    while tokens and (tokens[0].isdigit() or tokens[0] in LEADING_STOPWORDS or tokens[0] in MONTHS):
        tokens.pop(0)

    # Els noms molt llargs es retallen: la cua sol ser referencia interna.
    normalized = " ".join(tokens[:6])[:200].strip(" .")
    if not normalized:
        normalized = " ".join(strip_accents(source).upper().split())[:200]
    return normalized, display_name(normalized)


def display_name(normalized: str) -> str:
    """Converteix la clau en majuscules en un nom llegible."""
    words = []
    for position, word in enumerate(normalized.split()):
        if position > 0 and word in CONNECTORS:
            # «Comunitat de Propietaris», no «Comunitat DE Propietaris».
            words.append(word.lower())
        elif word in COMPANY_SUFFIXES or (
            len(word) <= 3 and word.isupper() and not word.isdigit() and word not in SHORT_WORDS
        ):
            # Sigles i codis curts com SA, SL, 4B es deixen tal qual.
            words.append(word)
        else:
            words.append(word.capitalize())
    return " ".join(words)
