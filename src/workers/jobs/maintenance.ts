/**
 * Manteniment.
 *
 * L'aplicacio de Python no esborrava mai les sessions caducades i la taula
 * creixia per sempre.
 */

import { purgeExpiredSessions } from "../../lib/auth.ts";

export async function feinaManteniment(): Promise<string> {
  const esborrades = await purgeExpiredSessions();
  return `${esborrades} sessions caducades esborrades`;
}
