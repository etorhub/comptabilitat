"""Categories d'un espai. Cada espai te el seu pla, sense res compartit."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select, update

from app.deps import DbSession, EditableWorkspace, Workspace
from app.models import Category, LlmSuggestion, Merchant, RecurringSeries, Rule, Transaction
from app.schemas.common import Message
from app.schemas.transaction import CategoryCreate, CategoryOut, CategoryUpdate
from app.services.seed import SLUG_INTERNAL_TRANSFER, SLUG_UNCATEGORIZED, slugify

router = APIRouter(prefix="/categories", tags=["categories"])

PROTECTED_SLUGS = {SLUG_UNCATEGORIZED, SLUG_INTERNAL_TRANSFER}


def _to_out(
    category: Category,
    *,
    transaction_count: int = 0,
    total_amount: Decimal = Decimal(0),
) -> CategoryOut:
    return CategoryOut(
        id=category.id,
        parent_id=category.parent_id,
        slug=category.slug,
        name=category.name,
        full_name=category.full_name,
        kind=category.kind,
        color=category.color,
        icon=category.icon,
        is_system=category.is_system,
        is_subscription=category.is_subscription,
        transaction_count=transaction_count,
        total_amount=total_amount,
    )


def _get_in_workspace(db: DbSession, workspace, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None or category.ledger_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria no trobada")
    return category


def _ensure_two_level_depth(db: DbSession, workspace, parent_id: int | None) -> None:
    if parent_id is None:
        return
    parent = _get_in_workspace(db, workspace, parent_id)
    if parent.parent_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nomes s'admeten dos nivells")


def _ensure_not_reparenting_parent(db: DbSession, workspace, category: Category) -> None:
    child_count = db.scalar(
        select(func.count(Category.id)).where(
            Category.ledger_id == workspace.id, Category.parent_id == category.id
        )
    )
    if child_count:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No es pot canviar el pare d'una categoria que te subcategories",
        )


def _category_stats(db: DbSession, workspace) -> dict[int, tuple[int, Decimal]]:
    rows = db.execute(
        select(
            Transaction.category_id,
            func.count(Transaction.id),
            func.coalesce(func.sum(Transaction.amount), 0),
        )
        .where(Transaction.ledger_id == workspace.id, Transaction.category_id.is_not(None))
        .group_by(Transaction.category_id)
    ).all()
    return {category_id: (count, Decimal(str(total))) for category_id, count, total in rows}


def _rollup_stats(
    categories: list[Category], stats: dict[int, tuple[int, Decimal]]
) -> dict[int, tuple[int, Decimal]]:
    rolled: dict[int, tuple[int, Decimal]] = {}
    for category in categories:
        count, total = stats.get(category.id, (0, Decimal(0)))
        rolled[category.id] = (count, total)
    for category in categories:
        if category.parent_id is not None:
            parent_count, parent_total = rolled.get(category.parent_id, (0, Decimal(0)))
            child_count, child_total = rolled[category.id]
            rolled[category.parent_id] = (
                parent_count + child_count,
                parent_total + child_total,
            )
    return rolled


def _reassign_category_references(db: DbSession, workspace, from_id: int, to_id: int) -> None:
    db.execute(
        update(Transaction)
        .where(Transaction.ledger_id == workspace.id, Transaction.category_id == from_id)
        .values(category_id=to_id)
    )
    db.execute(
        update(Merchant)
        .where(Merchant.ledger_id == workspace.id, Merchant.default_category_id == from_id)
        .values(default_category_id=to_id)
    )
    db.execute(
        update(Rule)
        .where(Rule.ledger_id == workspace.id, Rule.set_category_id == from_id)
        .values(set_category_id=to_id)
    )
    db.execute(
        update(RecurringSeries)
        .where(RecurringSeries.ledger_id == workspace.id, RecurringSeries.category_id == from_id)
        .values(category_id=to_id)
    )
    db.execute(
        update(LlmSuggestion)
        .where(LlmSuggestion.suggested_category_id == from_id)
        .values(suggested_category_id=to_id)
    )


@router.get("", response_model=list[CategoryOut])
def list_categories(
    db: DbSession,
    workspace: Workspace,
    with_stats: bool = Query(default=False),
):
    categories = db.scalars(
        select(Category)
        .where(Category.ledger_id == workspace.id)
        .order_by(Category.kind, Category.position, Category.name)
    ).all()
    if not with_stats:
        return [_to_out(category) for category in categories]

    stats = _rollup_stats(categories, _category_stats(db, workspace))
    return [
        _to_out(
            category,
            transaction_count=stats.get(category.id, (0, Decimal(0)))[0],
            total_amount=stats.get(category.id, (0, Decimal(0)))[1],
        )
        for category in categories
    ]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: DbSession, workspace: EditableWorkspace):
    parent = None
    if payload.parent_id is not None:
        parent = _get_in_workspace(db, workspace, payload.parent_id)
        _ensure_two_level_depth(db, workspace, payload.parent_id)

    base_slug = f"{parent.slug}-{slugify(payload.name)}" if parent else slugify(payload.name)
    slug = base_slug
    suffix = 2
    while db.scalar(
        select(Category).where(Category.ledger_id == workspace.id, Category.slug == slug)
    ):
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    category = Category(
        ledger_id=workspace.id,
        slug=slug,
        name=payload.name,
        kind=parent.kind if parent else payload.kind,
        parent_id=parent.id if parent else None,
        color=payload.color,
        icon=payload.icon,
        is_subscription=payload.is_subscription,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return _to_out(category)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdate, db: DbSession, workspace: EditableWorkspace
):
    category = _get_in_workspace(db, workspace, category_id)
    data = payload.model_dump(exclude_unset=True)
    if (parent_id := data.get("parent_id")) is not None:
        if parent_id == category_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Una categoria no pot ser pare d'ella mateixa"
            )
        _ensure_two_level_depth(db, workspace, parent_id)
        _ensure_not_reparenting_parent(db, workspace, category)
    for field, value in data.items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return _to_out(category)


@router.delete("/{category_id}", response_model=Message)
def delete_category(
    category_id: int,
    db: DbSession,
    workspace: EditableWorkspace,
    reassign_to: int | None = Query(default=None),
):
    """Esborra una categoria. Si te moviments, cal passar reassign_to."""
    category = _get_in_workspace(db, workspace, category_id)

    if category.slug in PROTECTED_SLUGS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Aquesta categoria del sistema no es pot esborrar"
        )

    child_count = db.scalar(
        select(func.count(Category.id)).where(
            Category.ledger_id == workspace.id, Category.parent_id == category_id
        )
    )
    if child_count:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Primer cal esborrar o moure les subcategories",
        )

    used = db.scalar(
        select(func.count(Transaction.id)).where(Transaction.category_id == category_id)
    )
    if used and reassign_to is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Hi ha {used} moviments en aquesta categoria"
        )

    if reassign_to is not None:
        if reassign_to == category_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "No es pot reassignar a la mateixa categoria"
            )
        _get_in_workspace(db, workspace, reassign_to)
        _reassign_category_references(db, workspace, category_id, reassign_to)

    db.delete(category)
    db.commit()
    return Message(message="Categoria esborrada")
