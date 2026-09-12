/**
 * The import job.
 */

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { bankConnections } from "../../db/schema/index.ts";
import { checkConsents } from "../../services/consent.ts";
import { syncConnection } from "../../services/sync.ts";

export async function syncJob(
  options: { connectionId?: number | null; daysBack?: number | null } = {},
): Promise<string> {
  const lines: string[] = [];

  const connections =
    options.connectionId != null
      ? await db
          .select()
          .from(bankConnections)
          .where(eq(bankConnections.id, options.connectionId))
      : await db
          .select()
          .from(bankConnections)
          .where(
            and(eq(bankConnections.status, "active"), isNotNull(bankConnections.ebSessionId)),
          );

  for (const connection of connections) {
    const result = await syncConnection(connection, {
      trigger: options.connectionId != null ? "manual" : "scheduled",
      daysBack: options.daysBack ?? null,
    });
    lines.push(
      `${connection.aspspName}: ${result.inserted} nous, ${result.updatedCount} actualitzats` +
        (result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""),
    );
  }

  const consents = await checkConsents();
  if (consents > 0) lines.push(`${consents} avisos de consentiment`);

  return lines.length > 0 ? lines.join("\n") : "no hi ha cap connexio activa";
}
