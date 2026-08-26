"""Categories d'un espai. Cada espai te el seu pla, sense res compartit."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.deps import DbSession, EditableWorkspace, Workspace
from app.models import Category, Transaction
from app.schemas.common import Message
from app.schemas.transaction import CategoryCreate, CategoryOut, CategoryUpdate
from app.services.seed import slugify

router = APIRouter(prefix="/categories", tags=["categories"])


def _to_out(category: Category) -> CategoryOut:
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
    )


def _get_in_workspace(db: DbSession, workspace, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None or category.ledger_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria no trobada")
    return category


@router.get("", response_model=list[CategoryOut])
def list_categories(db: DbSession, workspace: Workspace):
    categories = db.scalars(
        select(Category)
        .where(Category.ledger_id == workspace.id)
        .order_by(Category.kind, Category.position, Category.name)
    ).all()
    return [_to_out(category) for category in categories]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: DbSession, workspace: EditableWorkspace):
    parent = None
    if payload.parent_id is not None:
        parent = _get_in_workspace(db, workspace, payload.parent_id)

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
    )
    db.add(category)
    db.commit()
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
        _get_in_workspace(db, workspace, parent_id)
    for field, value in data.items():
        setattr(category, field, value)
    db.commit()
    return _to_out(category)


@router.delete("/{category_id}", response_model=Message)
def delete_category(category_id: int, db: DbSession, workspace: EditableWorkspace):
    """Nomes es poden esborrar categories propies i sense moviments."""
    category = _get_in_workspace(db, workspace, category_id)
    if category.is_system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Les categories del sistema no s'esborren")

    used = db.scalar(
        select(func.count(Transaction.id)).where(Transaction.category_id == category_id)
    )
    if used:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Hi ha {used} moviments en aquesta categoria"
        )
    db.delete(category)
    db.commit()
    return Message(message="Categoria esborrada")
