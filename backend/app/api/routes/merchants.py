"""Comercos: la memoria que evita tornar a classificar el que ja se sap."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from app.deps import CurrentUser, DbSession
from app.models import Category, Merchant
from app.schemas.common import Page
from app.schemas.transaction import MerchantOut, MerchantUpdate
from app.services.classification import remember_merchant_choice

router = APIRouter(prefix="/merchants", tags=["comercos"])


@router.get("", response_model=Page[MerchantOut])
def list_merchants(
    db: DbSession,
    user: CurrentUser,
    search: str | None = None,
    only_unclassified: bool = False,
    only_unconfirmed: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    condition = []
    if search:
        pattern = f"%{search.strip()}%"
        condition.append(
            or_(Merchant.normalized_name.ilike(pattern), Merchant.display_name.ilike(pattern))
        )
    if only_unclassified:
        condition.append(Merchant.default_category_id.is_(None))
    if only_unconfirmed:
        condition.append(Merchant.is_confirmed.is_(False))

    total = db.scalar(select(func.count(Merchant.id)).where(*condition))
    rows = db.scalars(
        select(Merchant)
        .where(*condition)
        .order_by(Merchant.transaction_count.desc(), Merchant.normalized_name)
        .limit(limit)
        .offset(offset)
    ).all()
    return Page[MerchantOut](
        items=[MerchantOut.model_validate(item) for item in rows],
        total=int(total or 0),
        limit=limit,
        offset=offset,
    )


@router.patch("/{merchant_id}", response_model=MerchantOut)
def update_merchant(merchant_id: int, payload: MerchantUpdate, db: DbSession, user: CurrentUser):
    """Confirma el comerc i, per defecte, propaga la categoria als seus moviments."""
    merchant = db.get(Merchant, merchant_id)
    if merchant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comerc no trobat")

    data = payload.model_dump(exclude_unset=True)
    if display_name := data.get("display_name"):
        merchant.display_name = display_name[:200]

    if "default_category_id" in data:
        category_id = data["default_category_id"]
        if category_id is not None and db.get(Category, category_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Categoria inexistent")
        remember_merchant_choice(
            db, merchant, category_id, apply_to_existing=payload.apply_to_existing
        )

    db.commit()
    return MerchantOut.model_validate(merchant)
