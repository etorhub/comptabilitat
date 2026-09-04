/**
 * Feina programada: enviament dels avisos per correu.
 *
 * Traduccio de `backend/app/workers/jobs/notify.py`.
 */

import { notificaPendents } from "../../services/notify.ts";

export function feinaAvisos(): Promise<string> {
  return notificaPendents(false);
}

/** Nomes els urgents. Es crida cada hora; el resum sencer, un cop al dia. */
export function feinaAvisosUrgents(): Promise<string> {
  return notificaPendents(true);
}
