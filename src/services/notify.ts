/**
 * Enviament dels avisos per correu.
 *
 * Cada espai te els seus destinataris: l'avis d'un descobert a Calella nomes
 * va a qui li pertoca. Els avisos que no son de cap espai (connexions,
 * sincronitzacions) van als destinataris generals de la configuracio.
 *
 * Traduccio de `backend/app/workers/jobs/notify.py`.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import { alerts, ledgers, type Alert } from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { enviaCorreu, renderitzaResum, type EntradaResum } from "../lib/email.ts";
import { todayLocal } from "../lib/time.ts";

/** Data i hora locals, com les escrivia el `strftime("%d/%m/%Y %H:%M")`. */
const marcaLocal = new Intl.DateTimeFormat("ca-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: config.timezone,
});

function formataMarca(moment: Date): string {
  // L'`Intl` catala hi posa «, » entre la data i l'hora; el Python no.
  return marcaLocal.format(moment).replace(", ", " ");
}

function dataCurta(isoDate: string): string {
  const [any, mes, dia] = isoDate.split("-");
  return `${dia}/${mes}/${any}`;
}

/** A qui van els avisos d'aquest espai. */
export function destinatarisDe(recipientsEspai: readonly string[] | null): string[] {
  if (recipientsEspai !== null && recipientsEspai.length > 0) return [...recipientsEspai];
  return [...config.alertRecipients];
}

/**
 * Envia els avisos encara no notificats.
 *
 * Amb `nomesUrgents` nomes surten els critics, perque es pugui cridar cada
 * hora sense omplir la bustia; la resta van al resum diari.
 */
export async function notificaPendents(nomesUrgents = false): Promise<string> {
  const condicions = [isNull(alerts.notifiedAt), ne(alerts.status, "dismissed")];
  if (nomesUrgents) condicions.push(eq(alerts.severity, "critical"));

  const pendents = await db
    .select()
    .from(alerts)
    .where(and(...condicions))
    // Mateix ordre que el Python: `severity` es text, aixi que alfabeticament
    // «critical» < «info» < «warning» i els urgents surten primer.
    .orderBy(asc(alerts.severity), asc(alerts.createdAt));

  if (pendents.length === 0) return "Cap avis pendent d'enviar";

  const perEspai = new Map<number | null, Alert[]>();
  for (const avis of pendents) {
    const clau = avis.ledgerId;
    const llista = perEspai.get(clau);
    if (llista === undefined) perEspai.set(clau, [avis]);
    else llista.push(avis);
  }

  let enviats = 0;
  let pendentsSenseEnviar = 0;

  for (const [ledgerId, delEspai] of perEspai) {
    const [espai] =
      ledgerId === null
        ? []
        : await db.select().from(ledgers).where(eq(ledgers.id, ledgerId)).limit(1);

    const destinataris = destinatarisDe(espai?.alertRecipients ?? null);
    if (destinataris.length === 0) {
      console.info(
        `[avisos] sense destinataris per a ${espai?.name ?? "avisos generals"}: ` +
          `${delEspai.length} avisos queden pendents`,
      );
      pendentsSenseEnviar += delEspai.length;
      continue;
    }

    const titol = nomesUrgents ? "Avis urgent de la comptabilitat" : "Resum d'avisos";
    let subtitol = nomesUrgents
      ? "Hi ha una cosa que necessita atencio ara."
      : `Avisos nous del ${dataCurta(todayLocal())}.`;
    if (espai !== undefined) subtitol = `${espai.name} · ${subtitol}`;

    const entrades: EntradaResum[] = delEspai.map((avis) => ({
      severity: avis.severity,
      title: avis.title,
      body: avis.body,
      ledgerName: espai?.name ?? "",
      created: formataMarca(avis.createdAt),
    }));

    const { html, text } = await renderitzaResum(entrades, titol, subtitol);
    const nom = espai !== undefined ? `${titol} · ${espai.name}` : titol;
    const primer = delEspai[0];
    const assumpte =
      delEspai.length === 1 && primer !== undefined
        ? `${nom}: ${primer.title}`
        : `${nom} (${delEspai.length})`;

    if (!(await enviaCorreu(assumpte, html, text, destinataris))) {
      pendentsSenseEnviar += delEspai.length;
      continue;
    }

    const ara = new Date();
    for (const avis of delEspai) {
      await db.update(alerts).set({ notifiedAt: ara }).where(eq(alerts.id, avis.id));
    }
    enviats += delEspai.length;
  }

  if (enviats > 0 && pendentsSenseEnviar > 0) {
    return `${enviats} avisos enviats; ${pendentsSenseEnviar} pendents (sense destinatari o error)`;
  }
  if (enviats > 0) return `${enviats} avisos enviats per correu`;
  return `${pendentsSenseEnviar} avisos pendents: no hi ha destinataris o el correu ha fallat`;
}
