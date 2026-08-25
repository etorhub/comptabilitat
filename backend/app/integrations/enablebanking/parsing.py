"""Conversio de les respostes d'Enable Banking al model intern."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.models.enums import TransactionStatus

# Estats que Enable Banking pot retornar. La resta (rebutjats, cancel·lats) s'ignoren.
STATUS_MAP = {
    "BOOK": TransactionStatus.BOOKED,
    "BOOKED": TransactionStatus.BOOKED,
    "PDNG": TransactionStatus.PENDING,
    "PENDING": TransactionStatus.PENDING,
}


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    text = str(value)[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _first_identification(raw: dict[str, Any], scheme: str = "IBAN") -> str:
    account_id = raw.get("account_id") or {}
    if isinstance(account_id, dict) and account_id.get("iban"):
        return str(account_id["iban"])
    for item in raw.get("all_account_ids") or []:
        if isinstance(item, dict) and str(item.get("scheme_name", "")).upper() == scheme:
            return str(item.get("identification", ""))
    return ""


def parse_account(raw: dict[str, Any]) -> dict[str, Any]:
    """Camps d'un compte tal com els desem a la taula `accounts`."""
    return {
        "eb_account_uid": str(raw.get("uid") or ""),
        "name": str(raw.get("name") or raw.get("details") or ""),
        "product": str(raw.get("product") or ""),
        "iban": _first_identification(raw),
        "currency": str(raw.get("currency") or "EUR"),
        "cash_account_type": str(raw.get("cash_account_type") or ""),
        "usage": str(raw.get("usage") or ""),
        "raw": raw,
    }


def parse_balance(raw: dict[str, Any]) -> dict[str, Any] | None:
    amount_block = raw.get("balance_amount") or {}
    amount = _decimal(amount_block.get("amount"))
    if amount is None:
        return None
    return {
        "balance_type": str(raw.get("balance_type") or raw.get("name") or "OTHR"),
        "amount": amount,
        "currency": str(amount_block.get("currency") or "EUR"),
        "reference_date": _parse_date(raw.get("reference_date"))
        or _parse_date(raw.get("last_change_date_time")),
    }


def _party_name(raw: dict[str, Any], key: str) -> str:
    party = raw.get(key) or {}
    if isinstance(party, dict):
        return str(party.get("name") or "")
    return ""


def _remittance(raw: dict[str, Any]) -> str:
    info = raw.get("remittance_information")
    if isinstance(info, list):
        return " ".join(str(part).strip() for part in info if part).strip()
    if isinstance(info, str):
        return info.strip()
    return ""


def _bank_code(raw: dict[str, Any]) -> str:
    block = raw.get("bank_transaction_code") or {}
    if not isinstance(block, dict):
        return ""
    parts = [block.get("code"), block.get("sub_code")]
    joined = "/".join(str(part) for part in parts if part)
    return joined or str(block.get("description") or "")


@dataclass
class ParsedTransaction:
    """Moviment ja normalitzat, a punt per desar."""

    entry_reference: str | None
    transaction_id: str | None
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    status: TransactionStatus
    description: str
    counterparty: str
    bank_transaction_code: str
    raw: dict[str, Any] = field(default_factory=dict)

    def dedup_key(self) -> str:
        """Clau estable per no duplicar moviments entre sincronitzacions.

        Si el banc dona una referencia d'apunt, es fa servir tal qual. Si no,
        es calcula un resum de les dades que no canvien del moviment.
        """
        if self.entry_reference:
            return f"ref:{self.entry_reference}"[:64]
        digest = hashlib.sha256(
            "|".join(
                [
                    self.booking_date.isoformat(),
                    f"{self.amount:.2f}",
                    self.currency,
                    self.description.strip().lower(),
                    self.counterparty.strip().lower(),
                ]
            ).encode("utf-8")
        ).hexdigest()
        return f"h:{digest}"[:64]


def parse_transaction(raw: dict[str, Any]) -> ParsedTransaction | None:
    """Converteix un moviment de l'API. Retorna None si no s'ha de desar."""
    status = STATUS_MAP.get(str(raw.get("status") or "BOOK").upper())
    if status is None:
        return None

    amount_block = raw.get("transaction_amount") or {}
    amount = _decimal(amount_block.get("amount"))
    if amount is None:
        return None
    amount = abs(amount)
    if str(raw.get("credit_debit_indicator") or "").upper() != "CRDT":
        amount = -amount

    booking_date = (
        _parse_date(raw.get("booking_date"))
        or _parse_date(raw.get("value_date"))
        or _parse_date(raw.get("transaction_date"))
    )
    if booking_date is None:
        return None

    creditor = _party_name(raw, "creditor")
    debtor = _party_name(raw, "debtor")
    # La contrapart es qui rep el diner en una despesa i qui l'envia en un ingres.
    counterparty = creditor if amount < 0 else debtor

    description_parts = [
        _remittance(raw),
        counterparty,
        str(raw.get("note") or ""),
        str((raw.get("bank_transaction_code") or {}).get("description") or "")
        if isinstance(raw.get("bank_transaction_code"), dict)
        else "",
    ]
    seen: set[str] = set()
    description_bits: list[str] = []
    for part in description_parts:
        cleaned = " ".join(part.split())
        if cleaned and cleaned.lower() not in seen:
            seen.add(cleaned.lower())
            description_bits.append(cleaned)

    return ParsedTransaction(
        entry_reference=str(raw["entry_reference"]) if raw.get("entry_reference") else None,
        transaction_id=str(raw["transaction_id"]) if raw.get("transaction_id") else None,
        booking_date=booking_date,
        value_date=_parse_date(raw.get("value_date")),
        amount=amount,
        currency=str(amount_block.get("currency") or "EUR"),
        status=status,
        description=" · ".join(description_bits)[:1000],
        counterparty=counterparty[:200],
        bank_transaction_code=_bank_code(raw)[:60],
        raw=raw,
    )
