/**
 * Alert creation.
 *
 * An alert is only created if there is none with the same deduplication key,
 * **even if the existing one is dismissed**: if someone dismissed it, it must
 * not come back. The key includes the period, so the same condition does not
 * warn every day.
 *
 * A translation of `backend/app/services/alerts.py`.
 */

import { eq } from "drizzle-orm";

import { db, type Transactor } from "../db/client.ts";
import { alerts, type Alert, type AlertSeverity, type AlertType } from "../db/schema/index.ts";

export interface AlertNew {
  type: AlertType;
  ledgerId: number | null;
  dedupKey: string;
  title: string;
  body?: string;
  severity?: AlertSeverity;
  payload?: Record<string, unknown>;
}

/** Creates the alert, or returns `null` if there was already an equal one. */
export async function createAlert(
  alert: AlertNew,
  connection: Transactor = db,
): Promise<Alert | null> {
  const [existing] = await connection
    .select({ id: alerts.id })
    .from(alerts)
    .where(eq(alerts.dedupKey, alert.dedupKey))
    .limit(1);

  if (existing) return null;

  const [creat] = await connection
    .insert(alerts)
    .values({
      ledgerId: alert.ledgerId,
      type: alert.type,
      severity: alert.severity ?? "warning",
      status: "new",
      dedupKey: alert.dedupKey.slice(0, 200),
      title: alert.title.slice(0, 250),
      body: alert.body ?? "",
      payload: alert.payload ?? {},
      notifiedAt: null,
    })
    .returning();

  return creat ?? null;
}
