/**
 * Feina programada: enviament dels avisos per correu.
 *
 * Traduccio de `backend/app/workers/jobs/notify.py`.
 */

import { notifyPending } from "../../services/notify.ts";

export function alertsJob(): Promise<string> {
  return notifyPending(false);
}

/** Nomes els urgents. Es crida cada hora; el resum sencer, un cop al dia. */
export function urgentAlertsJob(): Promise<string> {
  return notifyPending(true);
}
