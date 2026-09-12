/**
 * Sending alerts by mail.
 *
 * Alert text carries merchant names that come from the bank, so the HTML body
 * is built with Hono's `html` tag, which escapes whatever is interpolated into
 * it. The mail itself is Catalan: it is read by the people using the app.
 *
 * Translated from `backend/app/notifications/email.py`.
 */

import { html } from "hono/html";
import nodemailer from "nodemailer";

import type { AlertSeverity } from "../db/schema/enums.ts";
import { config, smtpConfigured } from "./config.ts";

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "Urgent",
  warning: "Atencio",
  info: "Informatiu",
};

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
};

/** One alert, with its workspace name and an already-formatted date. */
export interface SummaryEntry {
  severity: AlertSeverity;
  title: string;
  body: string;
  ledgerName: string;
  created: string;
}

export interface Summary {
  html: string;
  text: string;
}

/** Returns the HTML body and the plain-text body of the alert summary. */
export async function renderSummary(
  entries: readonly SummaryEntry[],
  title: string,
  subtitle: string,
): Promise<Summary> {
  const blocks = await Promise.all(
    entries.map(
      (e) => html`
        <div
          style="border-left:4px solid ${SEVERITY_COLOR[e.severity]};
                 background:#f8fafc; padding:12px 16px; margin:12px 0;"
        >
          <div
            style="font-size:12px; text-transform:uppercase; letter-spacing:.05em;
                   color:${SEVERITY_COLOR[e.severity]};"
          >
            ${SEVERITY_LABEL[e.severity]}${e.ledgerName !== "" ? ` · ${e.ledgerName}` : ""}
          </div>
          <div style="font-weight:600; margin:4px 0;">${e.title}</div>
          <div style="color:#334155;">${e.body}</div>
          <div style="color:#94a3b8; font-size:12px; margin-top:6px;">${e.created}</div>
        </div>
      `,
    ),
  );

  const document = await html`<!doctype html>
    <html lang="ca">
      <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a;">
        <h2 style="margin-bottom:4px;">${title}</h2>
        <p style="color:#64748b; margin-top:0;">${subtitle}</p>
        ${blocks}
        <p style="margin-top:24px;">
          <a href="${config.publicBaseUrl}" style="color:#2563eb;">Obre la comptabilitat</a>
        </p>
      </body>
    </html>`;

  const lines: string[] = [title, subtitle, ""];
  for (const entry of entries) {
    lines.push(`[${SEVERITY_LABEL[entry.severity]}] ${entry.title}`);
    if (entry.body !== "") lines.push(`  ${entry.body}`);
    lines.push("");
  }
  lines.push(config.publicBaseUrl);

  return { html: String(document), text: lines.join("\n") };
}

/**
 * Sends a mail. Returns whether it went out.
 *
 * NOTE: `smtpConfigured` requires `ALERT_RECIPIENTS` to be non-empty, even
 * though a workspace can have recipients of its own. That is the existing
 * behaviour; it means that without a general list, per-workspace alerts do not
 * go out either. Kept as it was, so nothing changes silently.
 */
export async function sendMail(
  subject: string,
  htmlBody: string,
  textBody: string,
  recipients?: readonly string[],
): Promise<boolean> {
  const target = recipients ?? config.alertRecipients;
  if (!smtpConfigured() || target.length === 0) {
    console.info(`[correu] no configurat: no s'envia «${subject}»`);
    return false;
  }

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    // 465 is encrypted from the first byte; the rest start in the clear and
    // upgrade to TLS with STARTTLS, as Python's `smtplib` did.
    secure: config.smtpPort === 465,
    requireTLS: config.smtpPort !== 465 && config.smtpStarttls,
    ...(config.smtpUser !== ""
      ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
      : {}),
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  });

  try {
    await transport.sendMail({
      from: config.smtpFrom,
      to: [...target],
      subject,
      text: textBody,
      html: htmlBody,
    });
  } catch (error) {
    // On some servers the error message carries the SMTP password: only the
    // short text is logged, never the whole object.
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[correu] no s'ha pogut enviar «${subject}»: ${detail}`);
    return false;
  } finally {
    transport.close();
  }

  console.info(`[correu] enviat: ${subject} → ${target.join(", ")}`);
  return true;
}
