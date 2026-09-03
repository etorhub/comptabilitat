/**
 * Feina d'analisi: recurrents, rebuts que falten i previsio de descobert.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers } from "../../db/schema/index.ts";
import { comprovaDescoberts } from "../../services/forecast.ts";
import {
  comprovaRebutsQueFalten,
  detectaRecurrents,
  resumRecurrents,
} from "../../services/recurring.ts";

export async function feinaAnalisi(): Promise<string> {
  const linies: string[] = [];

  for (const espai of await db.select().from(ledgers).where(eq(ledgers.isActive, true))) {
    const recurrents = await detectaRecurrents(espai.id);
    const falten = await comprovaRebutsQueFalten(espai.id);
    const descoberts = await comprovaDescoberts(espai);
    linies.push(
      `${espai.name}: ${resumRecurrents(recurrents)}, ${falten} rebuts que falten, ${descoberts} avisos de descobert`,
    );
  }

  return linies.join("\n") || "no hi ha cap espai actiu";
}
