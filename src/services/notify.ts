/**
 * Enviament dels avisos per correu.
 *
 * Cada espai te els seus destinataris: l'avis d'un descobert a Calella nomes
 * va a qui li pertoca. Els avisos que no son de cap espai (connexions,
 * sincronitzacions) van als destinataris generals de la configuracio.
 *
 * Traduccio de `backend/app/workers/jobs/notify.py`.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import { alerts, ledgers, type Alert } from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { sendMail, renderSummary, type SummaryEntry } from "../lib/email.ts";
import { todayLocal } from "../lib/time.ts";

/** Data i hora locals, com les escrivia el `strftime("%d/%m/%Y %H:%M")`. */
const marcaLocal = new Intl.DateTimeFormat("ca-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: config.timezone,
});

function formataMarca(moment: Date): string {
  // L'`Intl` catala hi posa «, » entre la data i l'hora; el Python no.
  return marcaLocal.format(moment).replace(", ", " ");
}

function dateCurta(isoDate: string): string {
  const [any, mes, day] = isoDate.split("-");
  return `${day}/${mes}/${any}`;
}

/** A qui van els avisos d'aquest espai. */
export function recipientsOf(recipientsEspai: readonly string[] | null): string[] {
  if (recipientsEspai !== null && recipientsEspai.length > 0) return [...recipientsEspai];
  return [...config.alertRecipients];
}

/**
 * Envia els avisos encara no notificats.
 *
 * Amb `nomesUrgents` nomes surten els critics, perque es pugui cridar cada
 * hora sense omplir la bustia; la resta van al resum diari.
 */
export async function notifyPending(nomesUrgents = false): Promise<string> {
  const condicions = [isNull(alerts.notifiedAt), ne(alerts.status, "dismissed")];
  if (nomesUrgents) condicions.push(eq(alerts.severity, "critical"));

  const pending = await db
    .select()
    .from(alerts)
    .where(and(...condicions))
    // Mateix ordre que el Python: `severity` es text, aixi que alfabeticament
    // «critical» < «info» < «warning» i els urgents surten primer.
    .orderBy(asc(alerts.severity), asc(alerts.createdAt));

  if (pending.length === 0) return "Cap avis pendent d'enviar";

  const byWorkspace = new Map<number | null, Alert[]>();
  for (const alert of pending) {
    const key = alert.ledgerId;
    const list = byWorkspace.get(key);
    if (list === undefined) byWorkspace.set(key, [alert]);
    else list.push(alert);
  }

  let enviats = 0;
  let pendingUnsent = 0;

  for (const [ledgerId, delEspai] of byWorkspace) {
    const [workspace] =
      ledgerId === null
        ? []
        : await db.select().from(ledgers).where(eq(ledgers.id, ledgerId)).limit(1);

    const recipients = recipientsOf(workspace?.alertRecipients ?? null);
    if (recipients.length === 0) {
      console.info(
        `[avisos] sense destinataris per a ${workspace?.name ?? "avisos generals"}: ` +
          `${delEspai.length} avisos queden pendents`,
      );
      pendingUnsent += delEspai.length;
      continue;
    }

    const titol = nomesUrgents ? "Avis urgent de la comptabilitat" : "Resum d'avisos";
    let subtitol = nomesUrgents
      ? "Hi ha una cosa que necessita atencio ara."
      : `Avisos nous del ${dateCurta(todayLocal())}.`;
    if (workspace !== undefined) subtitol = `${workspace.name} · ${subtitol}`;

    const entrades: SummaryEntry[] = delEspai.map((alert) => ({
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      ledgerName: workspace?.name ?? "",
      created: formataMarca(alert.createdAt),
    }));

    const { html, text } = await renderSummary(entrades, titol, subtitol);
    const name = workspace !== undefined ? `${titol} · ${workspace.name}` : titol;
    const first = delEspai[0];
    const assumpte =
      delEspai.length === 1 && first !== undefined
        ? `${name}: ${first.title}`
        : `${name} (${delEspai.length})`;

    if (!(await sendMail(assumpte, html, text, recipients))) {
      pendingUnsent += delEspai.length;
      continue;
    }

    const ara = new Date();
    for (const alert of delEspai) {
      await db.update(alerts).set({ notifiedAt: ara }).where(eq(alerts.id, alert.id));
    }
    enviats += delEspai.length;
  }

  if (enviats > 0 && pendingUnsent > 0) {
    return `${enviats} avisos enviats; ${pendingUnsent} pendents (sense destinatari o error)`;
  }
  if (enviats > 0) return `${enviats} avisos enviats per correu`;
  return `${pendingUnsent} avisos pendents: no hi ha destinataris o el correu ha fallat`;
}
