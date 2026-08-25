"""Assignacio de categoria als moviments.

Ordre de resolucio, del mes barat i explicit al mes car:
1. la decisio de l'usuari, que no es toca mai;
2. les regles, per prioritat;
3. la memoria de comercos (un comerc ja resolt abans);
4. el model local, que nomes mira els comercos que no han encaixat enlloc.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models import Category, Merchant, Rule, Transaction
from app.models.enums import CategoryKind, CategorySource, RuleSource
from app.services.rules import active_rules, first_matching_rule
from app.services.seed import get_category_by_slug

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

    rules = active_rules(db) if rules is None else rules
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


def classify_pending(db: Session, limit: int | None = None) -> ClassificationStats:
    """Classifica els moviments que encara no tenen categoria assignada."""
    stats = ClassificationStats()
    rules = active_rules(db)

    query = (
        select(Transaction)
        .where(
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
    """Aplica una regla acabada de crear als moviments ja importats."""
    updated = 0
    query = select(Transaction).where(Transaction.category_source != CategorySource.USER)
    if rule.ledger_id is not None:
        query = query.where(Transaction.ledger_id == rule.ledger_id)

    from app.services.rules import rule_matches

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
    db: Session,
    merchant: Merchant,
    category_id: int | None,
    apply_to_existing: bool = True,
    ledger_ids: list[int] | None = None,
) -> int:
    """Desa la decisio de l'usuari sobre un comerc i la propaga si cal.

    Amb `ledger_ids` la propagacio es limita a aquests llibres, perque un usuari
    no recategoritzi moviments de llibres que no pot ni veure.
    """
    merchant.default_category_id = category_id
    merchant.category_source = CategorySource.USER
    merchant.is_confirmed = True

    if not apply_to_existing:
        db.flush()
        return 0

    condicions = [
        Transaction.merchant_id == merchant.id,
        Transaction.category_source != CategorySource.USER,
    ]
    if ledger_ids is not None:
        condicions.append(Transaction.ledger_id.in_(ledger_ids))

    result = db.execute(
        update(Transaction)
        .where(*condicions)
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
    """Crea una regla a partir d'una correccio de l'usuari.

    La regla queda lligada al llibre del moviment: qui la crea nomes te permis
    sobre aquell llibre, i una regla global podria recategoritzar moviments que
    ni tan sols pot veure.
    """
    pattern = transaction.normalized_description or transaction.counterparty
    if not pattern or category_id is None:
        return None

    existing = db.scalar(
        select(Rule).where(
            Rule.source == RuleSource.LEARNED,
            Rule.set_category_id == category_id,
            Rule.ledger_id == transaction.ledger_id,
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


def uncategorized_category(db: Session) -> Category | None:
    from app.services.seed import SLUG_UNCATEGORIZED

    return get_category_by_slug(db, SLUG_UNCATEGORIZED)


def transfer_category(db: Session) -> Category | None:
    from app.services.seed import SLUG_INTERNAL_TRANSFER

    category = get_category_by_slug(db, SLUG_INTERNAL_TRANSFER)
    if category is not None and category.kind is not CategoryKind.TRANSFER:
        return None
    return category
