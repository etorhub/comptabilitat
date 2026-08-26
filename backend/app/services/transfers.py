"""Deteccio de traspassos entre comptes d'un mateix espai.

Nomes s'aparellen moviments de dos comptes **del mateix espai**: si un espai en
te mes d'un, moure diners d'un a l'altre no es ni ingres ni despesa i no ha de
sortir als informes.

El que passa entre espais diferents no s'aparella: cada espai es una
comptabilitat propia, i uns diners que arriben de fora son una entrada de debo
per a qui mira aquell espai.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_local
from app.models import Transaction
from app.models.enums import CategorySource, TransactionStatus
from app.services.classification import transfer_category

logger = logging.getLogger(__name__)

# Marge de dies entre la sortida d'un compte i l'entrada a l'altre.
MATCH_WINDOW_DAYS = 3


def detect_transfers(db: Session, ledger_id: int, lookback_days: int = 120) -> int:
    """Aparella sortides i entrades equivalents entre comptes del mateix espai."""
    since = today_local() - timedelta(days=lookback_days)
    candidates = list(
        db.scalars(
            select(Transaction)
            .where(
                Transaction.ledger_id == ledger_id,
                Transaction.booking_date >= since,
                Transaction.transfer_group_id.is_(None),
                Transaction.status == TransactionStatus.BOOKED,
            )
            .order_by(Transaction.booking_date, Transaction.id)
        )
    )

    outgoing = [item for item in candidates if item.amount < 0]
    incoming = [item for item in candidates if item.amount > 0]
    if not outgoing or not incoming:
        return 0

    category = transfer_category(db, ledger_id)
    used: set[int] = set()
    pairs = 0

    for sortida in outgoing:
        match = _find_counterpart(sortida, incoming, used)
        if match is None:
            continue
        group = uuid.uuid4().hex[:32]
        for item in (sortida, match):
            item.transfer_group_id = group
            # La categoria d'un traspas no la decideix l'usuari cada vegada,
            # pero si ell n'hi ha posat una, es respecta.
            if category is not None and item.category_source is not CategorySource.USER:
                item.category_id = category.id
                item.category_source = CategorySource.RULE
                item.category_confidence = 1.0
                item.needs_review = False
        used.add(match.id)
        used.add(sortida.id)
        pairs += 1

    db.flush()
    if pairs:
        logger.info("S'han aparellat %s traspassos dins de l'espai %s", pairs, ledger_id)
    return pairs


def _find_counterpart(
    sortida: Transaction, incoming: list[Transaction], used: set[int]
) -> Transaction | None:
    target = -sortida.amount
    best: Transaction | None = None
    best_distance = MATCH_WINDOW_DAYS + 1

    for entrada in incoming:
        if entrada.id in used or entrada.id == sortida.id:
            continue
        if entrada.account_id == sortida.account_id:
            continue
        if entrada.amount != target:
            continue
        distance = abs((entrada.booking_date - sortida.booking_date).days)
        if distance > MATCH_WINDOW_DAYS:
            continue
        if distance < best_distance:
            best, best_distance = entrada, distance
    return best
