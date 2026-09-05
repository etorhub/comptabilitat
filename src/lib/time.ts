/**
 * Temps, sempre amb zona horaria explicita.
 *
 * L'aplicacio viu a `Europe/Madrid` i les dates dels moviments son dates de
 * calendari, no marques de temps: «el rebut del 3 de març» ha de ser el 3 de
 * març encara que el servidor corri en UTC.
 */

import { config } from "./config.ts";

export const LOCAL_TZ = config.timezone;

/** Data d'avui a la zona de l'aplicacio, com a `AAAA-MM-DD`. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Suma dies a una data `AAAA-MM-DD` i en torna una altra. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // `Date.UTC` per no ensopegar amb els canvis d'hora: aixo son dates de
  // calendari, no instants.
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Dies entre dues dates de calendari (`fins` menys `des`). */
export function daysBetween(des: string, fins: string): number {
  const [y1, m1, d1] = des.split("-").map(Number);
  const [y2, m2, d2] = fins.split("-").map(Number);
  const a = Date.UTC(y1 ?? 1970, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2 ?? 1970, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/** Formata una data de calendari per ensenyar-la. */
const formatador = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(isoDate: string): string {
  return formatador.format(new Date(`${isoDate}T00:00:00Z`));
}
