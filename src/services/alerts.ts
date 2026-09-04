/**
 * Creacio d'avisos.
 *
 * Un avis nomes es crea si no n'hi ha cap amb la mateixa clau de
 * deduplicacio, **encara que el que hi ha estigui descartat**: si algu l'ha
 * descartat, no ha de tornar. La clau inclou el periode, de manera que la
 * mateixa condicio no avisa cada dia.
 *
 * Traduccio de `backend/app/services/alerts.py`.
 */

import { eq } from "drizzle-orm";

import { db, type Db } from "../db/client.ts";
import { alerts, type Alert, type AlertSeverity, type AlertType } from "../db/schema/index.ts";

export interface AvisNou {
  type: AlertType;
  ledgerId: number | null;
  dedupKey: string;
  title: string;
  body?: string;
  severity?: AlertSeverity;
  payload?: Record<string, unknown>;
}

/** Crea l'avis, o retorna `null` si ja n'hi havia un d'igual. */
export async function creaAvis(avis: AvisNou, connexio: Db = db): Promise<Alert | null> {
  const [existent] = await connexio
    .select({ id: alerts.id })
    .from(alerts)
    .where(eq(alerts.dedupKey, avis.dedupKey))
    .limit(1);

  if (existent) return null;

  const [creat] = await connexio
    .insert(alerts)
    .values({
      ledgerId: avis.ledgerId,
      type: avis.type,
      severity: avis.severity ?? "warning",
      status: "new",
      dedupKey: avis.dedupKey.slice(0, 200),
      title: avis.title.slice(0, 250),
      body: avis.body ?? "",
      payload: avis.payload ?? {},
      notifiedAt: null,
    })
    .returning();

  return creat ?? null;
}
