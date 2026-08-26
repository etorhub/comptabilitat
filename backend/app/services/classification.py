"""Assignacio de categoria als moviments d'un espai.

Ordre de resolucio, del mes barat i explicit al mes car:
1. la decisio de l'usuari, que no es toca mai;
2. les regles de l'espai, per prioritat;
3. la memoria de comercos de l'espai (un comerc ja resolt abans);
4. el model local, que nomes mira els comercos que no han encaixat enlloc.

Tot passa dins d'un sol espai: res del que es decideix aqui afecta els altres.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models import Category, Merchant, Rule, Transaction
from app.models.enums import CategoryKind, CategorySource, RuleSource
from app.services.rules import active_rules, first_matching_rule, rule_matches
from app.services.seed import (
    SLUG_INTERNAL_TRANSFER,
    SLUG_UNCATEGORIZED,
    get_category_by_slug,
)

logger = logging.getLogger(__name__)


@dataclass
class ClassificationStats:
    by_rule: int = 0
    by_merchant: int = 0
    unresolved: int = 0

    def __str__(self) -> str:
        return (
            f"{self.by_rule} per regla, {self.by_merchant} per comerc, "
            f"{self.unresolved} pendents de revisar"
        )


def classify_transaction(
    db: Session, transaction: Transaction, rules: list[Rule] | None = None
) -> CategorySource:
    """Classifica un moviment. No toca mai el que ha decidit l'usuari."""
    if transaction.category_source is CategorySource.USER:
        return CategorySource.USER
    if transaction.ledger_id is None:
        # Un compte encara sense espai assignat: no hi ha ni regles ni categories.
        return CategorySource.NONE

    rules = active_rules(db, transaction.ledger_id) if rules is None else rules
    if (rule := first_matching_rule(rules, transaction)) is not None:
        if rule.set_category_id:
            transaction.category_id = rule.set_category_id
        if rule.set_merchant_id:
            transaction.merchant_id = rule.set_merchant_id
        if rule.set_tags:
            transaction.tags = sorted(set(transaction.tags or []) | set(rule.set_tags))
        transaction.category_source = CategorySource.RULE
        transaction.category_confidence = 1.0
        transaction.needs_review = False
        transaction.applied_rule_id = rule.id
        rule.match_count += 1
        return CategorySource.RULE

    merchant = db.get(Merchant, transaction.merchant_id) if transaction.merchant_id else None
    if merchant is not None and merchant.default_category_id:
        transaction.category_id = merchant.default_category_id
        transaction.category_source = CategorySource.MERCHANT
        transaction.category_confidence = 1.0 if merchant.is_confirmed else 0.8
        transaction.needs_review = not merchant.is_confirmed
        return CategorySource.MERCHANT

    transaction.category_source = CategorySource.NONE
    transaction.needs_review = True
    return CategorySource.NONE


def classify_pending(db: Session, ledger_id: int, limit: int | None = None) -> ClassificationStats:
    """Classifica els moviments d'un espai que encara no tenen categoria."""
    stats = ClassificationStats()
    rules = active_rules(db, ledger_id)

    query = (
        select(Transaction)
        .where(
            Transaction.ledger_id == ledger_id,
            Transaction.category_source.in_([CategorySource.NONE, CategorySource.MERCHANT]),
            or_(Transaction.category_id.is_(None), Transaction.needs_review.is_(True)),
        )
        .order_by(Transaction.booking_date.desc())
    )
    if limit:
        query = query.limit(limit)

    for transaction in db.scalars(query):
        source = classify_transaction(db, transaction, rules)
        if source is CategorySource.RULE:
            stats.by_rule += 1
        elif source is CategorySource.MERCHANT:
            stats.by_merchant += 1
        else:
            stats.unresolved += 1

    db.flush()
    return stats


def apply_rule_to_existing(db: Session, rule: Rule) -> int:
    """Aplica una regla acabada de crear als moviments ja importats del seu espai."""
    updated = 0
    query = select(Transaction).where(
        Transaction.ledger_id == rule.ledger_id,
        Transaction.category_source != CategorySource.USER,
    )

    for transaction in db.scalars(query):
        if not rule_matches(rule, transaction):
            continue
        if rule.set_category_id:
            transaction.category_id = rule.set_category_id
        if rule.set_tags:
            transaction.tags = sorted(set(transaction.tags or []) | set(rule.set_tags))
        transaction.category_source = CategorySource.RULE
        transaction.category_confidence = 1.0
        transaction.needs_review = False
        transaction.applied_rule_id = rule.id
        updated += 1

    rule.match_count += updated
    db.flush()
    return updated


def remember_merchant_choice(
    db: Session, merchant: Merchant, category_id: int | None, apply_to_existing: bool = True
) -> int:
    """Desa la decisio de l'usuari sobre un comerc i la propaga dins del seu espai."""
    merchant.default_category_id = category_id
    merchant.category_source = CategorySource.USER
    merchant.is_confirmed = True

    if not apply_to_existing:
        db.flush()
        return 0

    result = db.execute(
        update(Transaction)
        .where(
            Transaction.merchant_id == merchant.id,
            Transaction.category_source != CategorySource.USER,
        )
        .values(
            category_id=category_id,
            category_source=CategorySource.MERCHANT,
            category_confidence=1.0,
            needs_review=False,
        )
    )
    db.flush()
    return int(result.rowcount or 0)


def build_learned_rule(
    db: Session,
    transaction: Transaction,
    category_id: int | None,
    created_by_id: int | None = None,
) -> Rule | None:
    """Crea una regla a l'espai del moviment a partir d'una correccio de l'usuari."""
    pattern = transaction.normalized_description or transaction.counterparty
    if not pattern or category_id is None or transaction.ledger_id is None:
        return None

    existing = db.scalar(
        select(Rule).where(
            Rule.source == RuleSource.LEARNED,
            Rule.ledger_id == transaction.ledger_id,
            Rule.set_category_id == category_id,
            Rule.name == pattern[:160],
        )
    )
    if existing is not None:
        return existing

    rule = Rule(
        name=pattern[:160],
        ledger_id=transaction.ledger_id,
        priority=50,
        conditions=[{"field": "normalized_description", "operator": "equals", "value": pattern}],
        set_category_id=category_id,
        source=RuleSource.LEARNED,
        created_by_id=created_by_id,
    )
    db.add(rule)
    db.flush()
    return rule


def uncategorized_category(db: Session, ledger_id: int) -> Category | None:
    return get_category_by_slug(db, ledger_id, SLUG_UNCATEGORIZED)


def transfer_category(db: Session, ledger_id: int) -> Category | None:
    category = get_category_by_slug(db, ledger_id, SLUG_INTERNAL_TRANSFER)
    if category is not None and category.kind is not CategoryKind.TRANSFER:
        return None
    return category
