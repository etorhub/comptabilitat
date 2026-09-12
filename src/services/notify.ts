/**
 * Sending the alerts by email.
 *
 * Each workspace has its own recipients: the alert about an overdraft in
 * Calella only goes to whoever it concerns. Alerts belonging to no workspace
 * (connections, synchronizations) go to the general recipients in the
 * configuration.
 *
 * A translation of `backend/app/workers/jobs/notify.py`.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import { alerts, ledgers, type Alert } from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { sendMail, renderSummary, type SummaryEntry } from "../lib/email.ts";
import { todayLocal } from "../lib/time.ts";

/** Local date and time, as `strftime("%d/%m/%Y %H:%M")` wrote them. */
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
  // The Catalan `Intl` puts «, » between the date and the time; the Python does not.
  return marcaLocal.format(moment).replace(", ", " ");
}

function dateCurta(isoDate: string): string {
  const [any, month, day] = isoDate.split("-");
  return `${day}/${month}/${any}`;
}

/** Who this workspace's alerts go to. */
export function recipientsOf(recipientsEspai: readonly string[] | null): string[] {
  if (recipientsEspai !== null && recipientsEspai.length > 0) return [...recipientsEspai];
  return [...config.alertRecipients];
}

/**
 * Sends the alerts that have not been notified yet.
 *
 * With `nomesUrgents` only the critical ones come out, so that it can be
 * called every hour without filling the inbox; the rest go in the daily digest.
 */
export async function notifyPending(nomesUrgents = false): Promise<string> {
  const condicions = [isNull(alerts.notifiedAt), ne(alerts.status, "dismissed")];
  if (nomesUrgents) condicions.push(eq(alerts.severity, "critical"));

  const pending = await db
    .select()
    .from(alerts)
    .where(and(...condicions))
    // Same order as the Python: `severity` is text, so alphabetically
    // «critical» < «info» < «warning» and the urgent ones come first.
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

    const title = nomesUrgents ? "Avis urgent de la comptabilitat" : "Resum d'avisos";
    let subtitle = nomesUrgents
      ? "Hi ha una cosa que necessita atencio ara."
      : `Avisos nous del ${dateCurta(todayLocal())}.`;
    if (workspace !== undefined) subtitle = `${workspace.name} · ${subtitle}`;

    const entrades: SummaryEntry[] = delEspai.map((alert) => ({
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      ledgerName: workspace?.name ?? "",
      created: formataMarca(alert.createdAt),
    }));

    const { html, text } = await renderSummary(entrades, title, subtitle);
    const name = workspace !== undefined ? `${title} · ${workspace.name}` : title;
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
