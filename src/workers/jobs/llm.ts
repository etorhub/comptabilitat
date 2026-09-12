/**
 * Scheduled job: the nightly classification with the local model, one
 * workspace at a time.
 *
 * It runs at night because on a NAS without a graphics card each question
 * takes seconds. Translated from `backend/app/workers/jobs/llm.py`.
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
