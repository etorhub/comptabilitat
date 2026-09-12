/**
 * The analysis job: recurring series, missing bills and the overdraft forecast.
 */

import { eq } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { ledgers } from "../../db/schema/index.ts";
import { checkOverdrafts } from "../../services/forecast.ts";
import {
  checkMissingBills,
  detectRecurring,
  summaryRecurring,
} from "../../services/recurring.ts";

export async function analysisJob(): Promise<string> {
  const lines: string[] = [];

  for (const workspace of await db.select().from(ledgers).where(eq(ledgers.isActive, true))) {
    const recurring = await detectRecurring(workspace.id);
    const falten = await checkMissingBills(workspace.id);
    const overdrafts = await checkOverdrafts(workspace);
    lines.push(
      `${workspace.name}: ${summaryRecurring(recurring)}, ${falten} rebuts que falten, ${overdrafts} avisos de descobert`,
    );
  }

  return lines.join("\n") || "no hi ha cap espai actiu";
}
