/**
 * Feina d'importacio.
 */

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../../db/client.ts";
import { bankConnections } from "../../db/schema/index.ts";
import { comprovaConsentiments, sincronitzaConnexio } from "../../services/sync.ts";

export async function feinaSincronitzacio(
  opcions: { connectionId?: number | null; daysBack?: number | null } = {},
): Promise<string> {
  const linies: string[] = [];

  const connexions =
    opcions.connectionId != null
      ? await db
          .select()
          .from(bankConnections)
          .where(eq(bankConnections.id, opcions.connectionId))
      : await db
          .select()
          .from(bankConnections)
          .where(
            and(
              eq(bankConnections.status, "active"),
              isNotNull(bankConnections.ebSessionId),
            ),
          );

  for (const connexio of connexions) {
    const resultat = await sincronitzaConnexio(connexio, {
      trigger: opcions.connectionId != null ? "manual" : "scheduled",
      daysBack: opcions.daysBack ?? null,
    });
    linies.push(
      `${connexio.aspspName}: ${resultat.inserits} nous, ${resultat.actualitzats} actualitzats` +
        (resultat.errors.length > 0 ? ` (${resultat.errors.length} errors)` : ""),
    );
  }

  const consentiments = await comprovaConsentiments();
  if (consentiments > 0) linies.push(`${consentiments} avisos de consentiment`);

  return linies.length > 0 ? linies.join("\n") : "no hi ha cap connexio activa";
}
