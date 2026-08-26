"""Dades d'exemple per poder provar l'aplicacio sense connectar cap banc.

Genera un any i mig de moviments amb la mateixa pinta que els del Santander,
incloent-hi rebuts recurrents, un traspas entre comptes propis i comercos
repetits, de manera que el panell, els informes i la previsio tinguin sentit.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.core.time import today_local, utcnow
from app.models import (
    Account,
    Balance,
    BankConnection,
    Category,
    Ledger,
    LedgerPermission,
    Merchant,
    Transaction,
    User,
)
from app.models.enums import ConnectionStatus, LedgerRole, TransactionStatus
from app.services.classification import classify_pending, remember_merchant_choice
from app.services.forecast import check_overdrafts
from app.services.merchants import get_or_create_merchant
from app.services.normalization import normalize_description
from app.services.recurring import detect_recurring
from app.services.seed import seed_ledgers
from app.services.transfers import detect_transfers

# Despeses variables: concepte tal com arribaria del banc i forquilla d'imports.
DESPESES = [
    ("COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA", -90, -25, "alimentacio-supermercat"),
    (
        "COMPRA TARJ. 5402XXXXXXXX1234 EN CARREFOUR EXPRESS, BARCELONA",
        -45,
        -12,
        "alimentacio-supermercat",
    ),
    ("PAGO MOVIL EN BAR EL RACO", -18, -6, "restauracio-bars-i-cafeteries"),
    ("COMPRA TARJ. 5402XXXXXXXX1234 EN REPSOL, GIRONA", -70, -40, "transport-combustible"),
    ("COMPRA TARJ. 5402XXXXXXXX1234 EN AMAZON EU SARL, MADRID", -60, -10, "compres-electronica"),
    ("PAGO MOVIL EN FARMACIA CENTRAL", -25, -8, "salut-farmacia"),
    (
        "COMPRA TARJ. 5402XXXXXXXX1234 EN DECATHLON, BARCELONA",
        -80,
        -15,
        "oci-i-cultura-esport-i-gimnas",
    ),
]


@dataclass
class Recurrent:
    concepte: str
    import_: Decimal
    dies: int
    llibre: str
    categoria: str


RECURRENTS = [
    Recurrent(
        "ADEUDO POR DOMICILIACION DE ENDESA ENERGIA XXI SLU",
        Decimal("-72.40"),
        30,
        "personal",
        "subministraments-electricitat",
    ),
    Recurrent(
        "RECIBO NETFLIX INTERNATIONAL B.V.",
        Decimal("-12.99"),
        30,
        "personal",
        "oci-i-cultura-subscripcions",
    ),
    Recurrent(
        "RECIBO SPOTIFY AB", Decimal("-11.99"), 30, "personal", "oci-i-cultura-subscripcions"
    ),
    Recurrent(
        "ADEUDO POR DOMICILIACION DE AGBAR AIGUES",
        Decimal("-38.10"),
        61,
        "calella",
        "subministraments-aigua",
    ),
    Recurrent(
        "ADEUDO POR DOMICILIACION DE COMUNITAT DE PROPIETARIS",
        Decimal("-45.00"),
        30,
        "calella",
        "habitatge-comunitat",
    ),
    Recurrent(
        "ADEUDO POR DOMICILIACION DE SEGURCAIXA ADESLAS",
        Decimal("-58.20"),
        30,
        "pardals",
        "salut-asseguranca-medica",
    ),
]

NOMINA = "NOMINA MES EMPRESA EXEMPLE SL"
SALDOS = {"personal": "2840.15", "calella": "610.40", "pardals": "1275.00"}
MESOS = 18


def _afegeix(
    db: Session, compte: Account, dia: date, import_: Decimal, concepte: str
) -> Merchant | None:
    normalitzat, mostra = normalize_description(concepte, "")
    import_ = Decimal(import_).quantize(Decimal("0.01"))
    moviment = Transaction(
        account_id=compte.id,
        ledger_id=compte.ledger_id,
        dedup_key=f"demo-{compte.id}-{dia}-{import_}-{concepte[:14]}"[:64],
        booking_date=dia,
        value_date=dia,
        amount=import_,
        description=concepte,
        normalized_description=normalitzat,
        status=TransactionStatus.BOOKED,
    )
    db.add(moviment)
    db.flush()
    comerc = get_or_create_merchant(db, compte.ledger_id, normalitzat, mostra, seen_on=dia)
    if comerc is not None:
        moviment.merchant_id = comerc.id
    return comerc


# Qui entra a cada espai, imitant el cas real: tu a tot arreu, la parella a
# Pardals i la sogra nomes a Calella.
DEMO_USERS = [
    (
        "demo@exemple.cat",
        "Tu",
        True,
        {"personal": LedgerRole.ADMIN, "calella": LedgerRole.ADMIN, "pardals": LedgerRole.ADMIN},
    ),
    ("parella@exemple.cat", "La parella", False, {"pardals": LedgerRole.EDITOR}),
    ("sogra@exemple.cat", "La sogra", False, {"calella": LedgerRole.VIEWER}),
]


def seed_demo_data(
    db: Session,
    email: str = "demo@exemple.cat",
    password: str = "comptabilitat",
    categoritza: bool = True,
) -> dict[str, int | str]:
    """Crea usuaris, comptes i moviments d'exemple. No fa res si ja hi ha dades."""
    if db.scalar(select(Account)) is not None:
        return {"estat": "ja hi havia dades; no s'ha tocat res"}

    random.seed(20260825)
    avui = today_local()

    seed_ledgers(db)
    llibres = {llibre.code: llibre for llibre in db.scalars(select(Ledger))}

    usuari = None
    for correu, nom, es_admin, accessos in DEMO_USERS:
        correu = email if correu == "demo@exemple.cat" else correu
        persona = db.scalar(select(User).where(User.email == correu))
        if persona is None:
            persona = User(
                email=correu,
                full_name=nom,
                password_hash=hash_password(password),
                is_admin=es_admin,
            )
            db.add(persona)
            db.flush()
            for codi, rol in accessos.items():
                if codi in llibres:
                    db.add(
                        LedgerPermission(user_id=persona.id, ledger_id=llibres[codi].id, role=rol)
                    )
        if es_admin:
            usuari = persona
    assert usuari is not None

    connexio = BankConnection(
        name="Santander (exemple)",
        aspsp_name="Santander",
        aspsp_country="ES",
        eb_session_id="demo-session",
        status=ConnectionStatus.ACTIVE,
        valid_until=utcnow() + timedelta(days=63),
        last_sync_at=utcnow(),
        created_by_id=usuari.id,
    )
    db.add(connexio)
    db.flush()

    comptes: dict[str, Account] = {}
    for index, (codi, llibre) in enumerate(llibres.items(), start=1):
        compte = Account(
            connection_id=connexio.id,
            ledger_id=llibre.id,
            eb_account_uid=f"demo-uid-{index}",
            name=f"Compte {llibre.name}",
            iban=f"ES91210004184502000513{index:02d}",
            cash_account_type="CACC",
            history_start_date=avui - timedelta(days=30 * MESOS),
            last_booked_date=avui,
        )
        db.add(compte)
        db.flush()
        comptes[codi] = compte
        db.add(
            Balance(
                account_id=compte.id,
                balance_type="CLBD",
                amount=Decimal(SALDOS.get(codi, "500.00")),
                reference_date=avui,
                fetched_at=utcnow(),
            )
        )

    principal = comptes.get("personal") or next(iter(comptes.values()))
    per_categoria: dict[str, str] = {}

    # Nomina i despeses variables mes a mes.
    for mes in range(MESOS, -1, -1):
        inici = avui - timedelta(days=30 * mes)
        comerc = _afegeix(
            db, principal, inici.replace(day=min(inici.day, 27)), Decimal("2450.00"), NOMINA
        )
        if comerc:
            per_categoria[comerc.normalized_name] = "ingressos-del-treball-nomina"

        for _ in range(random.randint(8, 16)):
            concepte, baix, alt, categoria = random.choice(DESPESES)
            dia = inici - timedelta(days=random.randint(0, 27))
            if dia > avui:
                continue
            comerc = _afegeix(db, principal, dia, Decimal(random.uniform(baix, alt)), concepte)
            if comerc:
                per_categoria[comerc.normalized_name] = categoria

    # Rebuts recurrents.
    for recurrent in RECURRENTS:
        compte = comptes.get(recurrent.llibre, principal)
        dia = avui - timedelta(days=recurrent.dies * (MESOS * 30 // recurrent.dies))
        while dia <= avui:
            comerc = _afegeix(db, compte, dia, recurrent.import_, recurrent.concepte)
            if comerc:
                per_categoria[comerc.normalized_name] = recurrent.categoria
            dia += timedelta(days=recurrent.dies)

    # Diners que passen d'un espai a l'altre. Amb espais estancs no s'aparellen:
    # son una sortida de debo a Personal i una entrada de debo a Calella.
    if len(comptes) > 1:
        altre = comptes.get("calella") or list(comptes.values())[1]
        dia = avui - timedelta(days=12)
        sortida = _afegeix(
            db, principal, dia, Decimal("-400.00"), "TRASPASO A CUENTA 12345678901234567890"
        )
        entrada = _afegeix(
            db, altre, dia, Decimal("400.00"), "TRASPASO DE CUENTA 12345678901234567890"
        )
        for comerc in (sortida, entrada):
            if comerc is not None:
                per_categoria[comerc.normalized_name] = "traspassos-traspas-entre-comptes-propis"

    db.flush()

    traspassos = 0
    descoberts = 0
    for llibre in llibres.values():
        traspassos += detect_transfers(db, llibre.id)

        if categoritza:
            # Es confirmen els comercos com ho faria una persona des de la safata
            # de revisio, perque els informes tinguin categories de bon principi.
            categories = {
                c.slug: c
                for c in db.scalars(select(Category).where(Category.ledger_id == llibre.id))
            }
            for comerc in db.scalars(select(Merchant).where(Merchant.ledger_id == llibre.id)):
                categoria = categories.get(per_categoria.get(comerc.normalized_name, ""))
                if categoria is not None:
                    remember_merchant_choice(db, comerc, categoria.id)

        classify_pending(db, llibre.id)
        detect_recurring(db, llibre.id)
        descoberts += check_overdrafts(db, llibre.id)

    total = int(db.scalar(select(func.count(Transaction.id))) or 0)
    return {
        "estat": "fet",
        "usuari": email,
        "altres_usuaris": ", ".join(c for c, *_ in DEMO_USERS[1:]),
        "contrasenya": password,
        "moviments": total,
        "comptes": len(comptes),
        "traspassos": traspassos,
        "avisos_de_descobert": descoberts,
    }
