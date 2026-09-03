/**
 * Enviament d'avisos per correu.
 *
 * El text dels avisos duu noms de comerç que venen del banc, aixi que el cos
 * HTML es munta amb l'etiqueta `html` de Hono, que escapa el que s'hi
 * interpola. Traduccio de `backend/app/notifications/email.py`.
 */

import { html } from "hono/html";
import nodemailer from "nodemailer";

import type { AlertSeverity } from "../db/schema/enums.ts";
import { config, smtpConfigured } from "./config.ts";

const ETIQUETA_GRAVETAT: Record<AlertSeverity, string> = {
  critical: "Urgent",
  warning: "Atencio",
  info: "Informatiu",
};

const COLOR_GRAVETAT: Record<AlertSeverity, string> = {
  critical: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
};

/** Un avis, amb el nom del seu espai i la data ja formatada. */
export interface EntradaResum {
  severity: AlertSeverity;
  title: string;
  body: string;
  ledgerName: string;
  created: string;
}

export interface Resum {
  html: string;
  text: string;
}

/** Retorna el cos HTML i el cos de text pla del resum d'avisos. */
export async function renderitzaResum(
  entrades: readonly EntradaResum[],
  titol: string,
  subtitol: string,
): Promise<Resum> {
  const blocs = await Promise.all(
    entrades.map(
      (e) => html`
        <div
          style="border-left:4px solid ${COLOR_GRAVETAT[e.severity]};
                 background:#f8fafc; padding:12px 16px; margin:12px 0;"
        >
          <div
            style="font-size:12px; text-transform:uppercase; letter-spacing:.05em;
                   color:${COLOR_GRAVETAT[e.severity]};"
          >
            ${ETIQUETA_GRAVETAT[e.severity]}${e.ledgerName !== "" ? ` · ${e.ledgerName}` : ""}
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
        <h2 style="margin-bottom:4px;">${titol}</h2>
        <p style="color:#64748b; margin-top:0;">${subtitol}</p>
        ${blocs}
        <p style="margin-top:24px;">
          <a href="${config.publicBaseUrl}" style="color:#2563eb;">Obre la comptabilitat</a>
        </p>
      </body>
    </html>`;

  const linies: string[] = [titol, subtitol, ""];
  for (const entrada of entrades) {
    linies.push(`[${ETIQUETA_GRAVETAT[entrada.severity]}] ${entrada.title}`);
    if (entrada.body !== "") linies.push(`  ${entrada.body}`);
    linies.push("");
  }
  linies.push(config.publicBaseUrl);

  return { html: String(document), text: linies.join("\n") };
}

/**
 * Envia un correu. Retorna si s'ha pogut enviar.
 *
 * NOTA: `smtpConfigured` exigeix que `ALERT_RECIPIENTS` no sigui buida, tot i
 * que un espai pot tenir els seus propis destinataris. Es el comportament que
 * hi havia; vol dir que, sense llista general, els avisos per espai tampoc no
 * surten. Es conserva tal qual per no canviar res sense dir-ho.
 */
export async function enviaCorreu(
  assumpte: string,
  cosHtml: string,
  cosText: string,
  destinataris?: readonly string[],
): Promise<boolean> {
  const objectiu = destinataris ?? config.alertRecipients;
  if (!smtpConfigured() || objectiu.length === 0) {
    console.info(`[correu] no configurat: no s'envia «${assumpte}»`);
    return false;
  }

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    // El 465 va xifrat des del primer byte; la resta comencen en clar i
    // pugen a TLS amb STARTTLS, com feia el `smtplib` de Python.
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
      to: [...objectiu],
      subject: assumpte,
      text: cosText,
      html: cosHtml,
    });
  } catch (error) {
    // El missatge de l'error pot dur la contrasenya de l'SMTP en alguns
    // servidors: nomes se'n registra el text curt, mai l'objecte sencer.
    const detall = error instanceof Error ? error.message : String(error);
    console.error(`[correu] no s'ha pogut enviar «${assumpte}»: ${detall}`);
    return false;
  } finally {
    transport.close();
  }

  console.info(`[correu] enviat: ${assumpte} → ${objectiu.join(", ")}`);
  return true;
}
