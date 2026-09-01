"""Consulta i edicio dels moviments d'un espai."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.deps import CurrentUser, DbSession, EditableWorkspace, Workspace
from app.models import Category, Ledger, LlmSuggestion, Merchant, Transaction
from app.models.enums import CategorySource, TransactionStatus
from app.schemas.common import Message, Page
from app.schemas.transaction import (
    BulkCategorize,
    ReviewItem,
    TransactionOut,
    TransactionUpdate,
)
from app.services.classification import build_learned_rule, remember_merchant_choice

router = APIRouter(prefix="/transactions", tags=["moviments"])


def to_out(transaction: Transaction) -> TransactionOut:
    data = TransactionOut.model_validate(transaction)
    data.category_name = transaction.category.full_name if transaction.category else None
    if transaction.is_masked:
        data.description = transaction.display_description or ""
        data.normalized_description = ""
        data.counterparty = ""
        data.merchant_name = None
        data.is_masked = True
    else:
        data.merchant_name = transaction.merchant.display_name if transaction.merchant else None
        data.is_masked = False
    return data


def search_clause(pattern: str):
    """Cerca el text visible. Un moviment enmascarat no es troba pel concepte del banc."""
    masked = Transaction.display_description.isnot(None)
    return or_(
        and_(
            masked,
            or_(
                Transaction.display_description.ilike(pattern),
                Transaction.notes.ilike(pattern),
            ),
        ),
        and_(
            Transaction.display_description.is_(None),
            or_(
                Transaction.description.ilike(pattern),
                Transaction.normalized_description.ilike(pattern),
                Transaction.counterparty.ilike(pattern),
                Transaction.notes.ilike(pattern),
            ),
        ),
    )


def _apply_filters(
    query,
    *,
    ledger_id: int,
    account_id: int | None,
    date_from: date | None,
    date_to: date | None,
    category_ids: list[int] | None,
    merchant_id: int | None,
    search: str | None,
    min_amount: Decimal | None,
    max_amount: Decimal | None,
    only_review: bool,
    only_uncategorized: bool,
    transaction_status: TransactionStatus | None,
    include_transfers: bool,
):
    query = query.where(Transaction.ledger_id == ledger_id)
    if account_id is not None:
        query = query.where(Transaction.account_id == account_id)
    if date_from is not None:
        query = query.where(Transaction.booking_date >= date_from)
    if date_to is not None:
        query = query.where(Transaction.booking_date <= date_to)
    if category_ids:
        query = query.where(Transaction.category_id.in_(category_ids))
    if merchant_id is not None:
        query = query.where(Transaction.merchant_id == merchant_id)
    if search:
        query = query.where(search_clause(f"%{search.strip()}%"))
    if min_amount is not None:
        query = query.where(Transaction.amount >= min_amount)
    if max_amount is not None:
        query = query.where(Transaction.amount <= max_amount)
    if only_review:
        query = query.where(Transaction.needs_review.is_(True))
    if only_uncategorized:
        query = query.where(Transaction.category_id.is_(None))
    if transaction_status is not None:
        query = query.where(Transaction.status == transaction_status)
    if not include_transfers:
        query = query.where(Transaction.transfer_group_id.is_(None))
    return query


@router.get("", response_model=Page[TransactionOut])
def list_transactions(
    db: DbSession,
    workspace: Workspace,
    account_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    category_ids: list[int] | None = Query(default=None),
    merchant_id: int | None = None,
    search: str | None = None,
    min_amount: Decimal | None = None,
    max_amount: Decimal | None = None,
    only_review: bool = False,
    only_uncategorized: bool = False,
    transaction_status: TransactionStatus | None = None,
    include_transfers: bool = True,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    filters = dict(
        ledger_id=workspace.id,
        account_id=account_id,
        date_from=date_from,
        date_to=date_to,
        category_ids=category_ids,
        merchant_id=merchant_id,
        search=search,
        min_amount=min_amount,
        max_amount=max_amount,
        only_review=only_review,
        only_uncategorized=only_uncategorized,
        transaction_status=transaction_status,
        include_transfers=include_transfers,
    )
    total = db.scalar(_apply_filters(select(func.count(Transaction.id)), **filters))
    rows = db.scalars(
        _apply_filters(select(Transaction), **filters)
        .order_by(Transaction.booking_date.desc(), Transaction.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return Page[TransactionOut](
        items=[to_out(item) for item in rows],
        total=int(total or 0),
        limit=limit,
        offset=offset,
    )


@router.get("/review", response_model=Page[ReviewItem])
def review_queue(
    db: DbSession,
    workspace: Workspace,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Cua de moviments pendents de revisar, amb el suggeriment del model."""
    condition = (Transaction.ledger_id == workspace.id) & (Transaction.needs_review.is_(True))
    total = db.scalar(select(func.count(Transaction.id)).where(condition))
    rows = db.scalars(
        select(Transaction)
        .where(condition)
        .order_by(Transaction.booking_date.desc(), Transaction.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    suggestions: dict[int, LlmSuggestion] = {}
    merchant_ids = {item.merchant_id for item in rows if item.merchant_id}
    if merchant_ids:
        for suggestion in db.scalars(
            select(LlmSuggestion)
            .where(LlmSuggestion.merchant_id.in_(merchant_ids))
            .order_by(LlmSuggestion.created_at)
        ):
            suggestions[suggestion.merchant_id] = suggestion

    items = []
    for transaction in rows:
        suggestion = suggestions.get(transaction.merchant_id or -1)
        items.append(
            ReviewItem(
                transaction=to_out(transaction),
                suggested_category_id=suggestion.suggested_category_id if suggestion else None,
                suggested_category_name=(
                    suggestion.suggested_category.full_name
                    if suggestion and suggestion.suggested_category
                    else None
                ),
                confidence=suggestion.confidence if suggestion else None,
                rationale=suggestion.rationale if suggestion else "",
            )
        )
    return Page[ReviewItem](items=items, total=int(total or 0), limit=limit, offset=offset)


@router.post("/bulk-categorize", response_model=Message)
def bulk_categorize(
    payload: BulkCategorize, db: DbSession, user: CurrentUser, workspace: EditableWorkspace
):
    """Assigna la mateixa categoria a un conjunt de moviments de l'espai."""
    category = _category_or_400(db, workspace, payload.category_id)

    transactions = list(
        db.scalars(
            select(Transaction).where(
                Transaction.id.in_(payload.transaction_ids),
                Transaction.ledger_id == workspace.id,
            )
        )
    )
    if len(transactions) != len(set(payload.transaction_ids)):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Algun moviment no existeix o no es d'aquest espai"
        )

    merchants: set[int] = set()
    for transaction in transactions:
        transaction.category_id = category.id if category else None
        transaction.category_source = CategorySource.USER
        transaction.category_confidence = 1.0
        transaction.needs_review = False
        if transaction.merchant_id:
            merchants.add(transaction.merchant_id)

    if payload.remember_merchant:
        for merchant_id in merchants:
            merchant = db.get(Merchant, merchant_id)
            if merchant is not None:
                remember_merchant_choice(db, merchant, category.id if category else None)

    db.commit()
    return Message(message=f"{len(transactions)} moviments actualitzats")


def _category_or_400(db: Session, workspace: Ledger, category_id: int | None) -> Category | None:
    """La categoria ha de ser d'aquest espai: no n'hi ha de compartides."""
    if category_id is None:
        return None
    category = db.get(Category, category_id)
    if category is None or category.ledger_id != workspace.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La categoria no es d'aquest espai")
    return category


def _get_in_workspace(db: Session, workspace: Ledger, transaction_id: int) -> Transaction:
    transaction = db.get(Transaction, transaction_id)
    if transaction is None or transaction.ledger_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Moviment no trobat")
    return transaction


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: int, db: DbSession, workspace: Workspace):
    return to_out(_get_in_workspace(db, workspace, transaction_id))


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    db: DbSession,
    user: CurrentUser,
    workspace: EditableWorkspace,
):
    """Actualitza un moviment. Canviar la categoria es una decisio de l'usuari
    i, per defecte, s'aprofita per recordar-la per a tot el comerc de l'espai."""
    transaction = _get_in_workspace(db, workspace, transaction_id)
    data = payload.model_dump(exclude_unset=True)
    remember = data.pop("remember_merchant", True)
    create_rule = data.pop("create_rule", False)

    if "category_id" in data:
        category = _category_or_400(db, workspace, data.pop("category_id"))
        category_id = category.id if category else None
        transaction.category_id = category_id
        transaction.category_source = CategorySource.USER
        transaction.category_confidence = 1.0
        transaction.needs_review = False

        _close_suggestion(db, transaction, category_id)

        if remember and transaction.merchant_id:
            merchant = db.get(Merchant, transaction.merchant_id)
            if merchant is not None:
                remember_merchant_choice(db, merchant, category_id)
        if create_rule:
            build_learned_rule(db, transaction, category_id, created_by_id=user.id)

    if "display_description" in data:
        _apply_display_description(db, workspace.id, transaction, data.pop("display_description"))

    for field, value in data.items():
        setattr(transaction, field, value)
    db.commit()
    db.refresh(transaction)
    return to_out(transaction)


def _apply_display_description(
    db: Session, ledger_id: int, transaction: Transaction, alias: str | None
) -> None:
    """Desa l'àlies i, si es un traspàs, el copia a l'altra cama."""
    value = alias.strip()[:200] if alias and alias.strip() else None
    transaction.display_description = value
    if not transaction.transfer_group_id:
        return
    siblings = db.scalars(
        select(Transaction).where(
            Transaction.transfer_group_id == transaction.transfer_group_id,
            Transaction.ledger_id == ledger_id,
            Transaction.id != transaction.id,
        )
    )
    for sibling in siblings:
        sibling.display_description = value


def _close_suggestion(db: Session, transaction: Transaction, category_id: int | None) -> None:
    """Marca si el suggeriment del model local era encertat."""
    if not transaction.merchant_id:
        return
    suggestion = db.scalar(
        select(LlmSuggestion)
        .where(LlmSuggestion.merchant_id == transaction.merchant_id)
        .order_by(LlmSuggestion.created_at.desc())
        .limit(1)
    )
    if suggestion is None or suggestion.accepted is not None:
        return
    suggestion.accepted = suggestion.suggested_category_id == category_id
    suggestion.reviewed_at = utcnow()


@router.get("/{transaction_id}/related", response_model=list[TransactionOut])
def related_transactions(transaction_id: int, db: DbSession, workspace: Workspace, limit: int = 20):
    """Altres moviments del mateix comerc, per veure el patro de despesa."""
    transaction = _get_in_workspace(db, workspace, transaction_id)
    if not transaction.merchant_id:
        return []
    rows = db.scalars(
        select(Transaction)
        .where(
            Transaction.merchant_id == transaction.merchant_id,
            Transaction.ledger_id == workspace.id,
            Transaction.id != transaction.id,
        )
        .order_by(Transaction.booking_date.desc())
        .limit(limit)
    ).all()
    return [to_out(item) for item in rows]
