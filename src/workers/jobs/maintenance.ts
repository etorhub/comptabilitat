/**
 * Manteniment.
 *
 * Les tres coses que, si no les fa ningu, van creixent, es queden penjades
 * per sempre, o queden mal posades: l'aplicacio de Python no esborrava mai les
 * sessions caducades i la taula creixia sense parar; una importacio morta
 * enmig deixa la pagina de connexions sondejant; i uns quants comerços queden
 * mal normalitzats (comissio accidental, prefix buit).
 */

import { purgeExpiredSessions } from "../../lib/auth.ts";
import { reassignaNormalitzacio } from "../../services/merchants.ts";
import { tancaImportacionsPenjades } from "../../services/sync.ts";

export async function feinaManteniment(): Promise<string> {
  // L'aplicacio de Python no esborrava mai les sessions caducades i la taula
  // creixia sense parar.
  const esborrades = await purgeExpiredSessions();

  // I una importacio que es va quedar a mitges deixa la pagina de connexions
  // sondejant cada dos segons per sempre.
  const penjades = await tancaImportacionsPenjades();
  const reassignacio = await reassignaNormalitzacio();

  return (
    `${esborrades} sessions caducades esborrades; ` +
    `${penjades} importacions penjades tancades; ` +
    `normalitzacio: ${reassignacio.canviats} de ${reassignacio.revisats} moviments reassignats`
  );
}
