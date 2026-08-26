"""Dades inicials: llibres i pla de categories en catala."""

from __future__ import annotations

import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, Ledger
from app.models.enums import CategoryKind

# (nom del pare, color, [fills])
EXPENSE_TREE: list[tuple[str, str, list[str]]] = [
    (
        "Habitatge",
        "#0ea5e9",
        [
            "Lloguer o hipoteca",
            "Comunitat",
            "IBI i taxes",
            "Reparacions i obres",
            "Mobiliari",
        ],
    ),
    (
        "Subministraments",
        "#22d3ee",
        [
            "Electricitat",
            "Aigua",
            "Gas",
            "Internet i telefon",
            "Residus",
        ],
    ),
    ("Alimentacio", "#16a34a", ["Supermercat", "Mercat i fruiteria", "Forn i pastisseria"]),
    ("Restauracio", "#f97316", ["Restaurants", "Bars i cafeteries", "Menjar a domicili"]),
    (
        "Transport",
        "#6366f1",
        [
            "Combustible",
            "Peatges i parquing",
            "Transport public",
            "Taxi i VTC",
            "Manteniment del vehicle",
            "Assegurança del vehicle",
            "Impost de circulacio",
        ],
    ),
    ("Salut", "#ef4444", ["Farmacia", "Metge i dentista", "Assegurança medica"]),
    (
        "Compres",
        "#a855f7",
        [
            "Roba i calçat",
            "Electronica",
            "Llar i bricolatge",
            "Regals",
        ],
    ),
    (
        "Oci i cultura",
        "#ec4899",
        [
            "Subscripcions",
            "Cinema i espectacles",
            "Esport i gimnas",
            "Llibres i premsa",
            "Viatges i vacances",
        ],
    ),
    ("Educacio", "#14b8a6", ["Matricules", "Material escolar", "Formacio"]),
    (
        "Serveis financers",
        "#64748b",
        [
            "Comissions bancaries",
            "Interessos i prestecs",
            "Assegurances",
            "Inversio",
        ],
    ),
    ("Impostos", "#78716c", ["IRPF", "IVA", "Altres impostos"]),
    ("Persones i familia", "#f59e0b", ["Cura de persones", "Mascotes", "Donacions"]),
    ("Altres despeses", "#94a3b8", ["Efectiu retirat", "Sense classificar"]),
]

INCOME_TREE: list[tuple[str, str, list[str]]] = [
    ("Ingressos del treball", "#16a34a", ["Nomina", "Facturacio i autonoms", "Pagues extra"]),
    ("Rendes", "#10b981", ["Lloguers cobrats", "Interessos i dividends"]),
    ("Prestacions", "#34d399", ["Pensions", "Subsidis i ajuts"]),
    ("Altres ingressos", "#4ade80", ["Devolucions", "Vendes", "Ingressos diversos"]),
]

TRANSFER_TREE: list[tuple[str, str, list[str]]] = [
    (
        "Traspassos",
        "#8b5cf6",
        [
            "Traspas entre comptes propis",
            "Liquidacio de targeta",
            "Amortitzacio de prestec",
        ],
    ),
]

DEFAULT_LEDGERS = [
    ("personal", "Personal", "#2563eb", "Comptabilitat personal"),
    ("calella", "Calella", "#0891b2", "Comptabilitat de Calella"),
    ("pardals", "Pardals", "#c2410c", "Comptabilitat de Pardals"),
]

# Categories que el codi necessita poder trobar pel seu identificador estable.
SLUG_UNCATEGORIZED = "altres-despeses-sense-classificar"
SLUG_INTERNAL_TRANSFER = "traspassos-traspas-entre-comptes-propis"
SLUG_CASH_WITHDRAWAL = "altres-despeses-efectiu-retirat"


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return "-".join(
        part for part in "".join(char if char.isalnum() else " " for char in ascii_text).split()
    )


def seed_ledgers(db: Session) -> list[Ledger]:
    """Crea els tres espais inicials, amb el seu pla de categories."""
    created: list[Ledger] = []
    for position, (code, name, color, description) in enumerate(DEFAULT_LEDGERS):
        if db.scalar(select(Ledger).where(Ledger.code == code)):
            continue
        ledger = Ledger(
            code=code, name=name, color=color, description=description, position=position
        )
        db.add(ledger)
        db.flush()
        seed_categories(db, ledger.id)
        created.append(ledger)
    db.flush()
    return created


def seed_categories(db: Session, ledger_id: int) -> int:
    """Crea el pla de categories d'un espai. Idempotent: es guia pel slug."""
    existing = set(db.scalars(select(Category.slug).where(Category.ledger_id == ledger_id)))
    created = 0
    trees = [
        (CategoryKind.EXPENSE, EXPENSE_TREE),
        (CategoryKind.INCOME, INCOME_TREE),
        (CategoryKind.TRANSFER, TRANSFER_TREE),
    ]
    position = 0
    for kind, tree in trees:
        for parent_name, color, children in tree:
            parent_slug = slugify(parent_name)
            parent = get_category_by_slug(db, ledger_id, parent_slug)
            if parent is None:
                parent = Category(
                    ledger_id=ledger_id,
                    slug=parent_slug,
                    name=parent_name,
                    kind=kind,
                    color=color,
                    is_system=True,
                    position=position,
                )
                db.add(parent)
                db.flush()
                created += 1
            position += 1
            for child_position, child_name in enumerate(children):
                child_slug = f"{parent_slug}-{slugify(child_name)}"
                if child_slug in existing:
                    continue
                db.add(
                    Category(
                        ledger_id=ledger_id,
                        slug=child_slug,
                        name=child_name,
                        kind=kind,
                        parent_id=parent.id,
                        color=color,
                        is_system=True,
                        position=child_position,
                    )
                )
                existing.add(child_slug)
                created += 1
    db.flush()
    return created


def get_category_by_slug(db: Session, ledger_id: int, slug: str) -> Category | None:
    return db.scalar(select(Category).where(Category.ledger_id == ledger_id, Category.slug == slug))
