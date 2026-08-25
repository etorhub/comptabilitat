"""Enviament d'avisos per correu."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from jinja2 import Template

from app.config import settings
from app.core.time import to_local
from app.models import Alert
from app.models.enums import AlertSeverity

logger = logging.getLogger(__name__)

SEVERITY_LABEL = {
    AlertSeverity.CRITICAL: "Urgent",
    AlertSeverity.WARNING: "Atencio",
    AlertSeverity.INFO: "Informatiu",
}
SEVERITY_COLOR = {
    AlertSeverity.CRITICAL: "#dc2626",
    AlertSeverity.WARNING: "#d97706",
    AlertSeverity.INFO: "#2563eb",
}

DIGEST_TEMPLATE = Template(
    """<!doctype html>
<html lang="ca">
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a;">
    <h2 style="margin-bottom:4px;">{{ title }}</h2>
    <p style="color:#64748b; margin-top:0;">{{ subtitle }}</p>
    {% for alert in alerts %}
      <div style="border-left:4px solid {{ colors[alert.severity] }};
                  background:#f8fafc; padding:12px 16px; margin:12px 0;">
        <div style="font-size:12px; text-transform:uppercase; letter-spacing:.05em;
                    color:{{ colors[alert.severity] }};">
          {{ labels[alert.severity] }}
          {%- if alert.ledger_name %} · {{ alert.ledger_name }}{% endif %}
        </div>
        <div style="font-weight:600; margin:4px 0;">{{ alert.title }}</div>
        <div style="color:#334155;">{{ alert.body }}</div>
        <div style="color:#94a3b8; font-size:12px; margin-top:6px;">{{ alert.created }}</div>
      </div>
    {% endfor %}
    <p style="margin-top:24px;">
      <a href="{{ base_url }}" style="color:#2563eb;">Obre la comptabilitat</a>
    </p>
  </body>
</html>"""
)


def render_digest(alerts: list[Alert], title: str, subtitle: str) -> tuple[str, str]:
    """Retorna (html, text) del resum d'avisos."""
    entries = [
        {
            "severity": alert.severity,
            "title": alert.title,
            "body": alert.body,
            "ledger_name": alert.ledger.name if getattr(alert, "ledger", None) else "",
            "created": to_local(alert.created_at).strftime("%d/%m/%Y %H:%M"),
        }
        for alert in alerts
    ]
    html = DIGEST_TEMPLATE.render(
        alerts=entries,
        title=title,
        subtitle=subtitle,
        labels=SEVERITY_LABEL,
        colors=SEVERITY_COLOR,
        base_url=settings.public_base_url,
    )
    lines = [title, subtitle, ""]
    for entry in entries:
        lines.append(f"[{SEVERITY_LABEL[entry['severity']]}] {entry['title']}")
        if entry["body"]:
            lines.append(f"  {entry['body']}")
        lines.append("")
    lines.append(settings.public_base_url)
    return html, "\n".join(lines)


def send_email(subject: str, html: str, text: str, recipients: list[str] | None = None) -> bool:
    """Envia un correu. Retorna si s'ha pogut enviar."""
    targets = recipients or settings.alert_recipients
    if not settings.smtp_configured or not targets:
        logger.info("Correu no configurat: no s'envia «%s»", subject)
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = ", ".join(targets)
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    try:
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30) as server:
                _login_and_send(server, message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
                if settings.smtp_starttls:
                    server.starttls()
                _login_and_send(server, message)
    except (smtplib.SMTPException, OSError) as exc:
        logger.error("No s'ha pogut enviar el correu «%s»: %s", subject, exc)
        return False

    logger.info("Correu enviat: %s → %s", subject, targets)
    return True


def _login_and_send(server: smtplib.SMTP, message: EmailMessage) -> None:
    if settings.smtp_user:
        server.login(settings.smtp_user, settings.smtp_password)
    server.send_message(message)
