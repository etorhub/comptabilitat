"""Classificacio dels comercos desconeguts amb el model local."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.core.time import utcnow
from app.integrations.ollama.client import OllamaClient, OllamaError, Suggestion
from app.integrations.ollama.prompts import PROMPT_VERSION, MerchantContext
from app.models import Category, LlmSuggestion, Merchant, Transaction
from app.models.enums import CategoryKind, CategorySource

logger = logging.getLogger(__name__)


@dataclass
class LlmStats:
    examined: int = 0
    classified: int = 0
    low_confidence: int = 0
    failed: int = 0
    skipped: str = ""

    def __str__(self) -> str:
        if self.skipped:
            return f"model local omes: {self.skipped}"
        return (
            f"model local: {self.examined} comercos mirats, {self.classified} classificats, "
            f"{self.low_confidence} amb poca confianca, {self.failed} amb error"
        )


def categories_catalog(db: Session) -> list[tuple[str, str]]:
    """Categories fulla amb el nom complet, que es el que veu el model."""
    categories = list(
        db.scalars(
            select(Category)
            .where(Category.kind != CategoryKind.TRANSFER)
            .order_by(Category.kind, Category.position)
        )
    )
    by_id = {category.id: category for category in categories}
    with_children = {category.parent_id for category in categories if category.parent_id}

    catalog: list[tuple[str, str]] = []
    for category in categories:
        if category.id in with_children:
            continue  # nomes les fulles
        parent = by_id.get(category.parent_id) if category.parent_id else None
        name = f"{parent.name} > {category.name}" if parent else category.name
        catalog.append((category.slug, name))
    return catalog


def merchants_to_classify(db: Session, limit: int) -> list[Merchant]:
    """Comercos sense categoria i que l'usuari no ha confirmat mai."""
    return list(
        db.scalars(
            select(Merchant)
            .where(
                Merchant.default_category_id.is_(None),
                Merchant.is_confirmed.is_(False),
            )
            .order_by(Merchant.transaction_count.desc())
            .limit(limit)
        )
    )


def build_context(db: Session, merchant: Merchant) -> MerchantContext:
    rows = list(
        db.scalars(
            select(Transaction)
            .where(Transaction.merchant_id == merchant.id)
            .order_by(Transaction.booking_date.desc())
            .limit(3)
        )
    )
    average = db.scalar(
        select(func.avg(Transaction.amount)).where(Transaction.merchant_id == merchant.id)
    ) or Decimal("0")
    return MerchantContext(
        normalized_name=merchant.display_name or merchant.normalized_name,
        sample_descriptions=[row.description for row in rows],
        typical_amount=f"{abs(Decimal(average)):.2f}",
        direction="ingres" if Decimal(average) > 0 else "despesa",
        occurrences=merchant.transaction_count,
    )


def _record_suggestion(
    db: Session,
    merchant: Merchant,
    suggestion: Suggestion,
    category: Category | None,
    context: MerchantContext,
) -> None:
    db.add(
        LlmSuggestion(
            merchant_id=merchant.id,
            model=suggestion.model,
            prompt_version=suggestion.prompt_version or PROMPT_VERSION,
            input_text=context.normalized_name,
            suggested_category_id=category.id if category else None,
            suggested_display_name=suggestion.merchant,
            confidence=suggestion.confidence,
            rationale=suggestion.rationale,
            created_at=utcnow(),
        )
    )


def classify_merchants(
    db: Session, client: OllamaClient | None = None, limit: int = 50
) -> LlmStats:
    """Fa que el model proposi categoria per als comercos desconeguts.

    Els suggeriments no es donen mai per bons: el moviment queda marcat per
    revisar i el comerc no es dona per confirmat fins que ho fa una persona.
    """
    stats = LlmStats()
    if not settings.ollama_enabled:
        stats.skipped = "desactivat a la configuracio"
        return stats

    pending = merchants_to_classify(db, limit)
    if not pending:
        stats.skipped = "no hi ha cap comerc nou per mirar"
        return stats

    owned_client = client is None
    client = client or OllamaClient()
    try:
        if not client.is_available():
            stats.skipped = "el model local no esta disponible"
            return stats

        catalog = categories_catalog(db)
        by_slug = {category.slug: category for category in db.scalars(select(Category))}

        for merchant in pending:
            stats.examined += 1
            context = build_context(db, merchant)
            try:
                suggestion = client.classify(context, catalog)
            except OllamaError as exc:
                logger.warning(
                    "El model no ha pogut classificar %s: %s", merchant.normalized_name, exc
                )
                stats.failed += 1
                continue

            category = by_slug.get(suggestion.category_slug)
            _record_suggestion(db, merchant, suggestion, category, context)

            if category is None:
                logger.info(
                    "El model ha proposat una categoria inexistent (%s) per a %s",
                    suggestion.category_slug,
                    merchant.normalized_name,
                )
                stats.failed += 1
                continue

            if suggestion.confidence < settings.ollama_min_confidence:
                stats.low_confidence += 1
                continue

            merchant.default_category_id = category.id
            merchant.category_source = CategorySource.LLM
            if suggestion.merchant:
                merchant.display_name = suggestion.merchant
            # Es proposa, pero cal que una persona ho validi.
            db.execute(
                update(Transaction)
                .where(
                    Transaction.merchant_id == merchant.id,
                    Transaction.category_source.in_([CategorySource.NONE]),
                )
                .values(
                    category_id=category.id,
                    category_source=CategorySource.LLM,
                    category_confidence=suggestion.confidence,
                    needs_review=True,
                )
            )
            stats.classified += 1
        db.flush()
    finally:
        if owned_client:
            client.close()

    return stats
