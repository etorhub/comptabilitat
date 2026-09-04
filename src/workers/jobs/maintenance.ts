/**
 * Manteniment.
 *
 * Les dues coses que, si no les fa ningu, van creixent o es queden penjades
 * per sempre.
 */

import { purgeExpiredSessions } from "../../lib/auth.ts";
import { tancaImportacionsPenjades } from "../../services/sync.ts";

export async function feinaManteniment(): Promise<string> {
  // L'aplicacio de Python no esborrava mai les sessions caducades i la taula
  // creixia sense parar.
  const esborrades = await purgeExpiredSessions();

  // I una importacio que es va quedar a mitges deixa la pagina de connexions
  // sondejant cada dos segons per sempre.
  const penjades = await tancaImportacionsPenjades();

  return `${esborrades} sessions caducades esborrades, ${penjades} importacions penjades tancades`;
}
