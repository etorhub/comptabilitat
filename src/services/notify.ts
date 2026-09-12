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
const localStamp = new Intl.DateTimeFormat("ca-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: config.timezone,
});

function formatStamp(when: Date): string {
  // The Catalan `Intl` puts «, » between the date and the time; the Python does not.
  return localStamp.format(when).replace(", ", " ");
}

function dateShort(isoDate: string): string {
  const [any, month, day] = isoDate.split("-");
  return `${day}/${month}/${any}`;
}

/** Who this workspace's alerts go to. */
export function recipientsOf(workspaceRecipients: readonly string[] | null): string[] {
  if (workspaceRecipients !== null && workspaceRecipients.length > 0)
    return [...workspaceRecipients];
  return [...config.alertRecipients];
}

/**
 * Sends the alerts that have not been notified yet.
 *
 * With `nomesUrgents` only the critical ones come out, so that it can be
 * called every hour without filling the inbox; the rest go in the daily digest.
 */
export async function notifyPending(urgentOnly = false): Promise<string> {
  const conditions = [isNull(alerts.notifiedAt), ne(alerts.status, "dismissed")];
  if (urgentOnly) conditions.push(eq(alerts.severity, "critical"));

  const pending = await db
    .select()
    .from(alerts)
    .where(and(...conditions))
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

  let sent = 0;
  let pendingUnsent = 0;

  for (const [ledgerId, workspaceAlerts] of byWorkspace) {
    const [workspace] =
      ledgerId === null
        ? []
        : await db.select().from(ledgers).where(eq(ledgers.id, ledgerId)).limit(1);

    const recipients = recipientsOf(workspace?.alertRecipients ?? null);
    if (recipients.length === 0) {
      console.info(
        `[avisos] sense destinataris per a ${workspace?.name ?? "avisos generals"}: ` +
          `${workspaceAlerts.length} avisos queden pendents`,
      );
      pendingUnsent += workspaceAlerts.length;
      continue;
    }

    const title = urgentOnly ? "Avis urgent de la comptabilitat" : "Resum d'avisos";
    let subtitle = urgentOnly
      ? "Hi ha una cosa que necessita atencio ara."
      : `Avisos nous del ${dateShort(todayLocal())}.`;
    if (workspace !== undefined) subtitle = `${workspace.name} · ${subtitle}`;

    const entries: SummaryEntry[] = workspaceAlerts.map((alert) => ({
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      ledgerName: workspace?.name ?? "",
      created: formatStamp(alert.createdAt),
    }));

    const { html, text } = await renderSummary(entries, title, subtitle);
    const name = workspace !== undefined ? `${title} · ${workspace.name}` : title;
    const first = workspaceAlerts[0];
    const subject =
      workspaceAlerts.length === 1 && first !== undefined
        ? `${name}: ${first.title}`
        : `${name} (${workspaceAlerts.length})`;

    if (!(await sendMail(subject, html, text, recipients))) {
      pendingUnsent += workspaceAlerts.length;
      continue;
    }

    const now = new Date();
    for (const alert of workspaceAlerts) {
      await db.update(alerts).set({ notifiedAt: now }).where(eq(alerts.id, alert.id));
    }
    sent += workspaceAlerts.length;
  }

  if (sent > 0 && pendingUnsent > 0) {
    return `${sent} avisos enviats; ${pendingUnsent} pendents (sense destinatari o error)`;
  }
  if (sent > 0) return `${sent} avisos enviats per correu`;
  return `${pendingUnsent} avisos pendents: no hi ha destinataris o el correu ha fallat`;
}
