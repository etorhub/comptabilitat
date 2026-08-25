"""Infraestructura comuna de proves. Cal un PostgreSQL accessible."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_TEST_URL = (
    "postgresql+psycopg://comptabilitat:comptabilitat@localhost:55432/comptabilitat_test"
)
TEST_DATABASE_URL = os.environ.setdefault("DATABASE_URL", DEFAULT_TEST_URL)
os.environ.setdefault("SECRET_KEY", "clau-de-proves")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("SCHEDULER_ENABLED", "false")

from app.core.security import hash_password  # noqa: E402
from app.db import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Ledger, LedgerPermission, User  # noqa: E402
from app.models.enums import LedgerRole  # noqa: E402
from app.services.seed import seed_categories  # noqa: E402


def _ensure_database() -> None:
    """Crea la base de dades de proves si no existeix."""
    url = sa.make_url(TEST_DATABASE_URL)
    admin_url = url.set(database="postgres")
    engine = sa.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as connection:
        exists = connection.execute(
            sa.text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database}
        ).scalar()
        if not exists:
            connection.execute(sa.text(f'CREATE DATABASE "{url.database}"'))
    engine.dispose()


@pytest.fixture(scope="session")
def engine() -> Iterator[sa.Engine]:
    _ensure_database()
    engine = sa.create_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine: sa.Engine) -> Iterator[Session]:
    """Sessio dins d'una transaccio que es desfa en acabar cada prova."""
    connection = engine.connect()
    transaction = connection.begin()
    # Amb `create_savepoint`, un rollback dins d'una ruta nomes desfa el seu
    # punt de control i no la transaccio que aïlla la prova.
    session = sessionmaker(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def categories(db: Session) -> None:
    seed_categories(db)
    db.flush()


@pytest.fixture
def ledgers(db: Session) -> dict[str, Ledger]:
    created = {}
    for position, code in enumerate(["personal", "calella", "pardals"]):
        ledger = Ledger(code=code, name=code.capitalize(), position=position)
        db.add(ledger)
        created[code] = ledger
    db.flush()
    return created


def make_user(
    db: Session,
    email: str = "prova@example.com",
    password: str = "contrasenya-llarga",
    is_admin: bool = False,
) -> User:
    user = User(email=email, password_hash=hash_password(password), is_admin=is_admin)
    db.add(user)
    db.flush()
    return user


def grant(db: Session, user: User, ledger: Ledger, role: LedgerRole = LedgerRole.EDITOR) -> None:
    db.add(LedgerPermission(user_id=user.id, ledger_id=ledger.id, role=role))
    db.flush()


def login(client: TestClient, email: str, password: str = "contrasenya-llarga") -> None:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
