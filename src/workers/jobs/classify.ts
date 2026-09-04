/**
 * Feina de classificacio: aparella traspassos i classifica el que queda.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers } from "../../db/schema/index.ts";
import { classificaPendents, resumEstadistiques } from "../../services/classification.ts";
import { detectaTraspassos } from "../../services/transfers.ts";

export async function feinaClassificacio(): Promise<string> {
  const linies: string[] = [];

  for (const espai of await db.select().from(ledgers).where(eq(ledgers.isActive, true))) {
    const traspassos = await detectaTraspassos(espai.id);
    const estadistiques = await classificaPendents(espai.id);
    linies.push(
      `${espai.name}: ${traspassos} traspassos, ${resumEstadistiques(estadistiques)}`,
    );
  }

  return linies.join("\n") || "no hi ha cap espai actiu";
}
