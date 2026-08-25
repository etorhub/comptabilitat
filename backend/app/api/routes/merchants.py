"""Comercos: la memoria que evita tornar a classificar el que ja se sap."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from app.deps import CurrentUser, DbSession, accessible_ledger_ids, resolve_ledger_scope
from app.models import Category, Merchant, Transaction
from app.models.enums import LedgerRole
from app.schemas.common import Page
from app.schemas.transaction import MerchantOut, MerchantUpdate
from app.services.classification import remember_merchant_choice

router = APIRouter(prefix="/merchants", tags=["comercos"])


def _vist_als_llibres_permesos(db: DbSession, user):
    """Condicio que limita els comercos als vistos als llibres de l'usuari.

    Els noms dels comercos inclouen persones (transferencies, Bizum), aixi que
    un usuari que nomes te un llibre no ha de veure els de la resta.
    """
    scope = resolve_ledger_scope(db, user, None)
    return (
        select(Transaction.id)
        .where(
            Transaction.merchant_id == Merchant.id,
            Transaction.ledger_id.in_(scope),
        )
        .exists()
    )


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
    condition = [] if user.is_admin else [_vist_als_llibres_permesos(db, user)]
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

    editables = accessible_ledger_ids(db, user, LedgerRole.EDITOR)
    if not user.is_admin:
        vist = db.scalar(
            select(Transaction.id)
            .where(
                Transaction.merchant_id == merchant.id,
                Transaction.ledger_id.in_(editables),
            )
            .limit(1)
        )
        if vist is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sense permis sobre aquest comerc")

    data = payload.model_dump(exclude_unset=True)
    if display_name := data.get("display_name"):
        merchant.display_name = display_name[:200]

    if "default_category_id" in data:
        category_id = data["default_category_id"]
        if category_id is not None and db.get(Category, category_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Categoria inexistent")
        remember_merchant_choice(
            db,
            merchant,
            category_id,
            apply_to_existing=payload.apply_to_existing,
            # La memoria de comercos es compartida, pero recategoritzar moviments
            # nomes pot afectar els llibres on l'usuari pot editar.
            ledger_ids=None if user.is_admin else editables,
        )

    db.commit()
    return MerchantOut.model_validate(merchant)
