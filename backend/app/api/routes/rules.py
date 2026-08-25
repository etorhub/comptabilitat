"""Regles de classificacio."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession, accessible_ledger_ids, get_ledger_or_403
from app.models import Category, Rule
from app.models.enums import LedgerRole
from app.schemas.common import Message
from app.schemas.transaction import RuleCreate, RuleOut, RuleUpdate
from app.services.classification import apply_rule_to_existing

router = APIRouter(prefix="/rules", tags=["regles"])


@router.get("", response_model=list[RuleOut])
def list_rules(db: DbSession, user: CurrentUser):
    """Regles globals mes les dels llibres als quals l'usuari te acces."""
    allowed = accessible_ledger_ids(db, user)
    condition = Rule.ledger_id.is_(None)
    if allowed:
        condition = condition | Rule.ledger_id.in_(allowed)
    rules = db.scalars(select(Rule).where(condition).order_by(Rule.priority, Rule.id)).all()
    return [RuleOut.model_validate(rule) for rule in rules]


@router.post("", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(payload: RuleCreate, db: DbSession, user: CurrentUser):
    if payload.ledger_id is not None:
        get_ledger_or_403(db, user, payload.ledger_id, LedgerRole.EDITOR)
    elif not user.is_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Nomes un administrador pot crear regles globals"
        )
    if payload.set_category_id and db.get(Category, payload.set_category_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Categoria inexistent")

    rule = Rule(
        name=payload.name,
        ledger_id=payload.ledger_id,
        priority=payload.priority,
        conditions=[condition.model_dump(mode="json") for condition in payload.conditions],
        set_category_id=payload.set_category_id,
        set_merchant_id=payload.set_merchant_id,
        set_tags=payload.set_tags,
        created_by_id=user.id,
    )
    db.add(rule)
    db.flush()
    if payload.apply_now:
        apply_rule_to_existing(db, rule)
    db.commit()
    return RuleOut.model_validate(rule)


@router.patch("/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: int, payload: RuleUpdate, db: DbSession, user: CurrentUser):
    rule = _get_editable(db, user, rule_id)
    data = payload.model_dump(exclude_unset=True)
    if conditions := data.pop("conditions", None):
        rule.conditions = [dict(condition) for condition in conditions]
    for field, value in data.items():
        setattr(rule, field, value)
    db.commit()
    return RuleOut.model_validate(rule)


@router.post("/{rule_id}/apply", response_model=Message)
def apply_rule(rule_id: int, db: DbSession, user: CurrentUser):
    """Torna a aplicar la regla als moviments ja importats."""
    rule = _get_editable(db, user, rule_id)
    updated = apply_rule_to_existing(db, rule)
    db.commit()
    return Message(message=f"{updated} moviments actualitzats")


@router.delete("/{rule_id}", response_model=Message)
def delete_rule(rule_id: int, db: DbSession, user: CurrentUser):
    rule = _get_editable(db, user, rule_id)
    db.delete(rule)
    db.commit()
    return Message(message="Regla esborrada")


def _get_editable(db: DbSession, user, rule_id: int) -> Rule:
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Regla no trobada")
    if rule.ledger_id is None:
        if not user.is_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Regla global: cal ser administrador")
    else:
        get_ledger_or_403(db, user, rule.ledger_id, LedgerRole.EDITOR)
    return rule
