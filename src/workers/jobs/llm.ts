/**
 * Feina programada: classificacio nocturna amb el model local, espai per espai.
 *
 * Es fa de nit perque en un NAS sense targeta grafica cada pregunta triga
 * segons. Traduccio de `backend/app/workers/jobs/llm.py`.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers } from "../../db/schema/index.ts";
import { classifyMerchants, summaryLlm } from "../../services/llm-classification.ts";

export async function localModelJob(limit = 50): Promise<string> {
  const linies: string[] = [];

  for (const workspace of await db.select().from(ledgers).where(eq(ledgers.isActive, true))) {
    const stats = await classifyMerchants(workspace.id, { limit });
    linies.push(`${workspace.name}: ${summaryLlm(stats)}`);
  }

  return linies.join("\n") || "no hi ha cap espai actiu";
}
