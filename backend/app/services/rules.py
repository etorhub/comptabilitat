"""Motor de regles de classificacio.

Una regla te una llista de condicions que s'avaluen totes en AND. Les regles
s'apliquen per prioritat (mes baixa, abans) i la primera que encaixa guanya.
"""

from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Rule, Transaction
from app.models.enums import RuleField, RuleOperator
from app.services.normalization import strip_accents

logger = logging.getLogger(__name__)


def _field_value(transaction: Transaction, field: RuleField) -> Any:
    match field:
        case RuleField.DESCRIPTION:
            return transaction.description
        case RuleField.NORMALIZED:
            return transaction.normalized_description
        case RuleField.COUNTERPARTY:
            return transaction.counterparty
        case RuleField.AMOUNT:
            return transaction.amount
        case RuleField.BANK_CODE:
            return transaction.bank_transaction_code
        case RuleField.ACCOUNT:
            return transaction.account_id
    return None


def _text(value: Any) -> str:
    return strip_accents(str(value or "")).upper().strip()


def condition_matches(condition: dict[str, Any], transaction: Transaction) -> bool:
    try:
        field = RuleField(condition["field"])
        operator = RuleOperator(condition["operator"])
    except (KeyError, ValueError):
        logger.warning("Condicio de regla no valida: %s", condition)
        return False

    raw_value = condition.get("value", "")
    actual = _field_value(transaction, field)

    if operator in (RuleOperator.GREATER_THAN, RuleOperator.LESS_THAN):
        try:
            threshold = Decimal(str(raw_value))
            current = Decimal(str(actual))
        except (InvalidOperation, ValueError, TypeError):
            return False
        return current > threshold if operator is RuleOperator.GREATER_THAN else current < threshold

    expected = _text(raw_value)
    current_text = _text(actual)
    match operator:
        case RuleOperator.CONTAINS:
            return expected in current_text
        case RuleOperator.EQUALS:
            return expected == current_text
        case RuleOperator.STARTS_WITH:
            return current_text.startswith(expected)
        case RuleOperator.REGEX:
            try:
                return re.search(str(raw_value), current_text, re.IGNORECASE) is not None
            except re.error:
                logger.warning("Expressio regular no valida a una regla: %s", raw_value)
                return False
    return False


def rule_matches(rule: Rule, transaction: Transaction) -> bool:
    if not rule.is_active or not rule.conditions:
        return False
    if rule.ledger_id is not None and rule.ledger_id != transaction.ledger_id:
        return False
    return all(condition_matches(condition, transaction) for condition in rule.conditions)


def active_rules(db: Session) -> list[Rule]:
    """Regles actives ordenades per prioritat; les d'un llibre concret abans."""
    return list(
        db.scalars(
            select(Rule)
            .where(Rule.is_active.is_(True))
            .order_by(Rule.priority, Rule.ledger_id.is_(None), Rule.id)
        )
    )


def first_matching_rule(rules: list[Rule], transaction: Transaction) -> Rule | None:
    for rule in rules:
        if rule_matches(rule, transaction):
            return rule
    return None
