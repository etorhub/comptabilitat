"""Regles de classificacio d'un espai."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession, EditableWorkspace, Workspace
from app.models import Category, Rule
from app.schemas.common import Message
from app.schemas.transaction import RuleCreate, RuleOut, RuleUpdate
from app.services.classification import apply_rule_to_existing

router = APIRouter(prefix="/rules", tags=["regles"])


def _get_in_workspace(db: DbSession, workspace, rule_id: int) -> Rule:
    rule = db.get(Rule, rule_id)
    if rule is None or rule.ledger_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Regla no trobada")
    return rule


@router.get("", response_model=list[RuleOut])
def list_rules(db: DbSession, workspace: Workspace):
    rules = db.scalars(
        select(Rule).where(Rule.ledger_id == workspace.id).order_by(Rule.priority, Rule.id)
    ).all()
    return [RuleOut.model_validate(rule) for rule in rules]


@router.post("", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(
    payload: RuleCreate, db: DbSession, user: CurrentUser, workspace: EditableWorkspace
):
    if payload.set_category_id is not None:
        category = db.get(Category, payload.set_category_id)
        if category is None or category.ledger_id != workspace.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La categoria no es d'aquest espai")

    rule = Rule(
        name=payload.name,
        ledger_id=workspace.id,
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
def update_rule(rule_id: int, payload: RuleUpdate, db: DbSession, workspace: EditableWorkspace):
    rule = _get_in_workspace(db, workspace, rule_id)
    data = payload.model_dump(exclude_unset=True)
    if conditions := data.pop("conditions", None):
        rule.conditions = [dict(condition) for condition in conditions]
    for field, value in data.items():
        setattr(rule, field, value)
    db.commit()
    return RuleOut.model_validate(rule)


@router.post("/{rule_id}/apply", response_model=Message)
def apply_rule(rule_id: int, db: DbSession, workspace: EditableWorkspace):
    """Torna a aplicar la regla als moviments ja importats de l'espai."""
    rule = _get_in_workspace(db, workspace, rule_id)
    updated = apply_rule_to_existing(db, rule)
    db.commit()
    return Message(message=f"{updated} moviments actualitzats")


@router.delete("/{rule_id}", response_model=Message)
def delete_rule(rule_id: int, db: DbSession, workspace: EditableWorkspace):
    rule = _get_in_workspace(db, workspace, rule_id)
    db.delete(rule)
    db.commit()
    return Message(message="Regla esborrada")
