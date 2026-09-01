"""Ordres de manteniment: `python -m app.cli <ordre>`."""

from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import select

from app.core.security import hash_password
from app.db import session_scope
from app.models import Ledger, LedgerPermission, User
from app.models.enums import LedgerRole
from app.services.seed import seed_categories, seed_ledgers


def cmd_init(args: argparse.Namespace) -> int:
    """Crea els llibres inicials i el pla de categories de cada espai."""
    with session_scope() as db:
        ledgers = seed_ledgers(db)
        categories = sum(seed_categories(db, ledger.id) for ledger in db.scalars(select(Ledger)))
    print(f"Llibres creats: {len(ledgers)}")
    print(f"Categories creades: {categories}")
    return 0


def _valida_correu(email: str) -> str | None:
    """L'API exigeix una adreça valida: si no ho es, l'usuari no podria entrar mai."""
    from pydantic import TypeAdapter, ValidationError
    from pydantic.networks import EmailStr

    try:
        return TypeAdapter(EmailStr).validate_python(email.strip()).lower()
    except ValidationError:
        return None


def cmd_create_user(args: argparse.Namespace) -> int:
    password = args.password or getpass.getpass("Contrasenya: ")
    if len(password) < 10:
        print("La contrasenya ha de tenir com a minim 10 caracters", file=sys.stderr)
        return 1
    email = _valida_correu(args.email)
    if email is None:
        print(f"«{args.email}» no es una adreça de correu valida", file=sys.stderr)
        return 1
    with session_scope() as db:
        if db.scalar(select(User).where(User.email == email)):
            print(f"L'usuari {email} ja existeix", file=sys.stderr)
            return 1
        user = User(
            email=email,
            full_name=args.name or "",
            password_hash=hash_password(password),
            is_admin=args.admin,
        )
        db.add(user)
        db.flush()
        if args.admin:
            print(f"Usuari administrador {email} creat (id={user.id})")
        else:
            print(f"Usuari {email} creat (id={user.id})")
    return 0


def cmd_grant(args: argparse.Namespace) -> int:
    with session_scope() as db:
        user = db.scalar(select(User).where(User.email == args.email.lower()))
        if user is None:
            print(f"Usuari no trobat: {args.email}", file=sys.stderr)
            return 1
        ledger = db.scalar(select(Ledger).where(Ledger.code == args.ledger))
        if ledger is None:
            print(f"Llibre no trobat: {args.ledger}", file=sys.stderr)
            return 1
        role = LedgerRole(args.role)
        permission = db.scalar(
            select(LedgerPermission).where(
                LedgerPermission.user_id == user.id, LedgerPermission.ledger_id == ledger.id
            )
        )
        if permission is None:
            db.add(LedgerPermission(user_id=user.id, ledger_id=ledger.id, role=role))
        else:
            permission.role = role
        print(f"{args.email} → {ledger.name}: {role.value}")
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    """Omple la base de dades amb moviments d'exemple per provar l'aplicacio."""
    from app.config import settings
    from app.services.demo import seed_demo_data

    if _valida_correu(args.email) is None:
        print(f"«{args.email}» no es una adreça de correu valida", file=sys.stderr)
        return 1

    if settings.environment == "production" and not args.force:
        print(
            "Aixo crea un usuari amb una contrasenya coneguda i no s'ha d'executar "
            "en produccio. Si realment ho vols, afegeix --force.",
            file=sys.stderr,
        )
        return 1

    with session_scope() as db:
        resultat = seed_demo_data(db, email=args.email, password=args.password)

    for clau, valor in resultat.items():
        print(f"{clau.replace('_', ' ')}: {valor}")
    if resultat.get("estat") == "fet":
        print(f"\nJa pots entrar amb {args.email} / {args.password}")
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    from app.workers.jobs.sync import run_sync_job

    result = run_sync_job(connection_id=args.connection_id, days_back=args.days_back)
    print(result)
    return 0


def cmd_classify(args: argparse.Namespace) -> int:
    from app.workers.jobs.classify import run_classification_job

    print(run_classification_job(use_llm=not args.no_llm))
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    from app.workers.jobs.analyze import run_analysis_job

    print(run_analysis_job())
    return 0


def cmd_notify(args: argparse.Namespace) -> int:
    from app.workers.jobs.notify import run_notification_job

    print(run_notification_job())
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="comptabilitat", description="Ordres de manteniment")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Crea llibres i categories inicials")
    p_init.set_defaults(func=cmd_init)

    p_user = sub.add_parser("create-user", help="Crea un usuari")
    p_user.add_argument("--email", required=True)
    p_user.add_argument("--password")
    p_user.add_argument("--name")
    p_user.add_argument("--admin", action="store_true")
    p_user.set_defaults(func=cmd_create_user)

    p_grant = sub.add_parser("grant", help="Dona acces a un llibre")
    p_grant.add_argument("--email", required=True)
    p_grant.add_argument("--ledger", required=True, help="Codi del llibre")
    p_grant.add_argument("--role", default="viewer", choices=[r.value for r in LedgerRole])
    p_grant.set_defaults(func=cmd_grant)

    p_demo = sub.add_parser("demo", help="Omple la base de dades amb dades d'exemple")
    p_demo.add_argument("--email", default="demo@exemple.cat")
    p_demo.add_argument("--password", default="comptabilitat")
    p_demo.add_argument("--force", action="store_true", help="Permet-ho tambe en produccio")
    p_demo.set_defaults(func=cmd_demo)

    p_sync = sub.add_parser("sync", help="Sincronitza els moviments amb el banc")
    p_sync.add_argument("--connection-id", type=int)
    p_sync.add_argument("--days-back", type=int)
    p_sync.set_defaults(func=cmd_sync)

    p_classify = sub.add_parser("classify", help="Classifica els moviments pendents")
    p_classify.add_argument("--no-llm", action="store_true", help="Nomes regles i comercos")
    p_classify.set_defaults(func=cmd_classify)

    p_analyze = sub.add_parser("analyze", help="Detecta recurrents i genera avisos")
    p_analyze.set_defaults(func=cmd_analyze)

    p_notify = sub.add_parser("notify", help="Envia per correu els avisos pendents")
    p_notify.set_defaults(func=cmd_notify)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
