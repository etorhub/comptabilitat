/**
 * The classification job: pairs transfers and classifies what is left.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers } from "../../db/schema/index.ts";
import { classifyPending, summaryStats } from "../../services/classification.ts";
import { detectTransfers } from "../../services/transfers.ts";

export async function classificationJob(): Promise<string> {
  const lines: string[] = [];

  for (const workspace of await db.select().from(ledgers).where(eq(ledgers.isActive, true))) {
    const transfers = await detectTransfers(workspace.id);
    const stats = await classifyPending(workspace.id);
    lines.push(`${workspace.name}: ${transfers} traspassos, ${summaryStats(stats)}`);
  }

  return lines.join("\n") || "no hi ha cap espai actiu";
}
