"""Avisos per correu."""

from __future__ import annotations

import smtplib

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Alert
from app.models.enums import AlertSeverity, AlertStatus, AlertType
from app.notifications.email import render_digest, send_email
from app.workers.jobs.notify import notify_pending


class FakeSMTP:
    """Servidor de correu simulat."""

    enviats: list = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def starttls(self):
        self.tls = True

    def login(self, user, password):
        self.user = user

    def send_message(self, message):
        FakeSMTP.enviats.append(message)


@pytest.fixture
def correu_configurat(monkeypatch):
    FakeSMTP.enviats = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "usuari")
    monkeypatch.setattr(settings, "smtp_password", "secret")
    monkeypatch.setattr(settings, "smtp_from", "comptes@example.com")
    monkeypatch.setattr(settings, "alert_recipients", ["etor@example.com"])
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)


def crea_avis(db, title="Possible descobert", severity=AlertSeverity.WARNING, key="a"):
    alert = Alert(
        type=AlertType.PROJECTED_OVERDRAFT,
        severity=severity,
        status=AlertStatus.NEW,
        dedup_key=key,
        title=title,
        body="El saldo baixaria de zero el 12/09/2026.",
    )
    db.add(alert)
    db.flush()
    return alert


def test_el_resum_inclou_tots_els_avisos(db):
    alerts = [crea_avis(db, "Primer", key="1"), crea_avis(db, "Segon", key="2")]

    html, text = render_digest(alerts, "Resum", "Avisos nous")

    assert "Primer" in html and "Segon" in html
    assert "Primer" in text and "Segon" in text
    assert settings.public_base_url in html


def test_sense_configuracio_no_senvia_res(db, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "")
    crea_avis(db)

    resultat = notify_pending(db)

    assert "no esta configurat" in resultat
    assert db.scalar(select(Alert)).notified_at is None


def test_els_avisos_senvien_i_es_marquen(db, correu_configurat):
    crea_avis(db, "Primer", key="1")
    crea_avis(db, "Segon", key="2")

    resultat = notify_pending(db)

    assert "2 avisos enviats" in resultat
    assert len(FakeSMTP.enviats) == 1
    message = FakeSMTP.enviats[0]
    assert message["To"] == "etor@example.com"
    assert "Resum d'avisos (2)" in message["Subject"]
    assert all(alert.notified_at is not None for alert in db.scalars(select(Alert)))


def test_no_es_repeteix_lenviament(db, correu_configurat):
    crea_avis(db)
    notify_pending(db)

    assert notify_pending(db) == "Cap avis pendent d'enviar"
    assert len(FakeSMTP.enviats) == 1


def test_el_mode_urgent_nomes_envia_els_critics(db, correu_configurat):
    crea_avis(db, "Normal", AlertSeverity.WARNING, key="1")
    crea_avis(db, "Urgent", AlertSeverity.CRITICAL, key="2")

    resultat = notify_pending(db, only_critical=True)

    assert "1 avisos enviats" in resultat
    assert "Urgent" in FakeSMTP.enviats[0]["Subject"]
    pendents = [a for a in db.scalars(select(Alert)) if a.notified_at is None]
    assert [alert.title for alert in pendents] == ["Normal"]


def test_els_avisos_descartats_no_senvien(db, correu_configurat):
    alert = crea_avis(db)
    alert.status = AlertStatus.DISMISSED
    db.flush()

    assert notify_pending(db) == "Cap avis pendent d'enviar"


def test_un_error_del_servidor_no_trenca_res(db, correu_configurat, monkeypatch):
    def peta(*args, **kwargs):
        raise smtplib.SMTPException("servidor caigut")

    monkeypatch.setattr(smtplib, "SMTP", peta)
    crea_avis(db)

    assert send_email("Prova", "<p>hola</p>", "hola") is False
    assert "ha fallat" in notify_pending(db)
