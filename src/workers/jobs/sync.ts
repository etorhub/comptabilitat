/**
 * The import job.
 */

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { bankConnections } from "../../db/schema/index.ts";
import { checkConsents } from "../../services/consent.ts";
import { sincronitzaConnection } from "../../services/sync.ts";

export async function syncJob(
  options: { connectionId?: number | null; daysBack?: number | null } = {},
): Promise<string> {
  const linies: string[] = [];

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
    const result = await sincronitzaConnection(connection, {
      trigger: options.connectionId != null ? "manual" : "scheduled",
      daysBack: options.daysBack ?? null,
    });
    linies.push(
      `${connection.aspspName}: ${result.inserits} nous, ${result.actualitzats} actualitzats` +
        (result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""),
    );
  }

  const consents = await checkConsents();
  if (consents > 0) linies.push(`${consents} avisos de consentiment`);

  return linies.length > 0 ? linies.join("\n") : "no hi ha cap connexio activa";
}
