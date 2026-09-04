/**
 * Feina programada: classificacio nocturna amb el model local, espai per espai.
 *
 * Es fa de nit perque en un NAS sense targeta grafica cada pregunta triga
 * segons. Traduccio de `backend/app/workers/jobs/llm.py`.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers } from "../../db/schema/index.ts";
import { classificaComercos, resumLlm } from "../../services/llm-classification.ts";

export async function feinaModelLocal(limit = 50): Promise<string> {
  const linies: string[] = [];

  for (const espai of await db.select().from(ledgers).where(eq(ledgers.isActive, true))) {
    const estadistiques = await classificaComercos(espai.id, { limit });
    linies.push(`${espai.name}: ${resumLlm(estadistiques)}`);
  }

  return linies.join("\n") || "no hi ha cap espai actiu";
}
