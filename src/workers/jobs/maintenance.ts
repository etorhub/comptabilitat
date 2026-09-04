/**
 * Manteniment.
 *
 * L'aplicacio de Python no esborrava mai les sessions caducades i la taula
 * creixia per sempre. Tambe corregeix comerços mal normalitzats (comissio
 * accidental, prefix buit) en una passada.
 */

import { purgeExpiredSessions } from "../../lib/auth.ts";
import { reassignaNormalitzacio } from "../../services/merchants.ts";

export async function feinaManteniment(): Promise<string> {
  const esborrades = await purgeExpiredSessions();
  const reassignacio = await reassignaNormalitzacio();
  return (
    `${esborrades} sessions caducades esborrades; ` +
    `normalitzacio: ${reassignacio.canviats} de ${reassignacio.revisats} moviments reassignats`
  );
}
