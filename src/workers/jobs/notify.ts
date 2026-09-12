/**
 * Scheduled job: sending the alerts by mail.
 *
 * Translated from `backend/app/workers/jobs/notify.py`.
 */

import { notifyPending } from "../../services/notify.ts";

export function alertsJob(): Promise<string> {
  return notifyPending(false);
}

/** The urgent ones only. Called hourly; the full summary, once a day. */
export function urgentAlertsJob(): Promise<string> {
  return notifyPending(true);
}
