"""Dades d'exemple: han de deixar l'aplicacio en un estat on tot es pugui mirar."""

from __future__ import annotations

from sqlalchemy import func, select

from app.models import Account, RecurringSeries, Transaction, User
from app.services.demo import seed_demo_data


def test_la_demo_crea_els_tres_usuaris_amb_accessos_diferents(db, client):
    """Tu a tot arreu, la parella a Pardals i la sogra només a Calella."""
    seed_demo_data(db)
    db.flush()

    from app.models import LedgerPermission

    accessos = {
        usuari.email: sorted(
            permis.ledger.code
            for permis in db.scalars(
                select(LedgerPermission).where(LedgerPermission.user_id == usuari.id)
            )
        )
        for usuari in db.scalars(select(User))
    }

    assert accessos["demo@exemple.cat"] == ["calella", "pardals", "personal"]
    assert accessos["parella@exemple.cat"] == ["pardals"]
    assert accessos["sogra@exemple.cat"] == ["calella"]


def test_la_demo_deixa_dades_a_punt(db, client):
    resultat = seed_demo_data(db)
    db.flush()

    assert resultat["estat"] == "fet"
    assert int(resultat["moviments"]) > 200
    assert int(resultat["comptes"]) == 3
    # Els tres llibres tenen comptes i moviments.
    assert db.scalar(select(func.count(Account.id))) == 3
    llibres = {t.ledger_id for t in db.scalars(select(Transaction))}
    assert len(llibres) == 3
    # Hi ha rebuts recurrents detectats, que son el que alimenta la previsio.
    assert db.scalar(select(func.count(RecurringSeries.id))) >= 5


def test_lusuari_de_la_demo_pot_entrar(db, client):
    """El correu ha de ser valid per a l'API: si no, l'usuari no entraria mai."""
    resultat = seed_demo_data(db)
    db.flush()

    resposta = client.post(
        "/api/auth/login",
        json={"email": resultat["usuari"], "password": resultat["contrasenya"]},
    )

    assert resposta.status_code == 200, resposta.text
    assert resposta.json()["is_admin"] is True
    # Els espais es demanen a part i han de ser els tres.
    espais = client.get("/api/workspaces").json()
    assert sorted(item["code"] for item in espais) == ["calella", "pardals", "personal"]


def test_els_moviments_queden_classificats(db, client):
    seed_demo_data(db)
    db.flush()

    sense_classificar = db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.category_id.is_(None), Transaction.transfer_group_id.is_(None)
        )
    )
    assert sense_classificar == 0


def test_la_demo_no_trepitja_dades_existents(db, client):
    seed_demo_data(db)
    db.flush()
    abans = db.scalar(select(func.count(Transaction.id)))

    segona = seed_demo_data(db)

    assert "ja hi havia dades" in str(segona["estat"])
    assert db.scalar(select(func.count(Transaction.id))) == abans
    assert db.scalar(select(func.count(User.id))) == 3
