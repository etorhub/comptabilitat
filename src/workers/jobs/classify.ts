/**
 * Feina de classificacio: aparella traspassos i classifica el que queda.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers } from "../../db/schema/index.ts";
import { classifyPending, summaryStats } from "../../services/classification.ts";
import { detectTransfers } from "../../services/transfers.ts";

export async function classificationJob(): Promise<string> {
  const linies: string[] = [];

  for (const workspace of await db.select().from(ledgers).where(eq(ledgers.isActive, true))) {
    const transfers = await detectTransfers(workspace.id);
    const stats = await classifyPending(workspace.id);
    linies.push(`${workspace.name}: ${transfers} traspassos, ${summaryStats(stats)}`);
  }

  return linies.join("\n") || "no hi ha cap espai actiu";
}
