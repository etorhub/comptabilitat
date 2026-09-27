/**
 * Time, always with an explicit zone.
 *
 * The application lives in `Europe/Madrid`, and transaction dates are calendar
 * dates, not timestamps: "the bill on 3 March" has to stay 3 March even when
 * the server runs in UTC.
 */

import { config } from "./config.ts";

export const LOCAL_TZ = config.timezone;

/** Today's date in the application's zone, as `YYYY-MM-DD`. */
export function todayLocal(): string {
  return localDateOf(new Date());
}

/** The calendar date an instant falls on in the application's zone, as `YYYY-MM-DD`. */
export function localDateOf(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Adds days to a `YYYY-MM-DD` date and returns another one. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // `Date.UTC` so daylight-saving changes cannot trip this up: these are
  // calendar dates, not instants.
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days between two calendar dates (`to` minus `from`). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1 ?? 1970, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2 ?? 1970, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/** Formats a calendar date for display. Catalan, because it is shown. */
const formatter = new Intl.DateTimeFormat("ca-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(isoDate: string): string {
  return formatter.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Moves a `YYYY-MM` month by `months` (negative goes back) and returns another one. */
export function addMonths(month: string, months: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Formats a `YYYY-MM` month for display: «agost del 2026». Catalan, because it is shown. */
const monthFormatter = new Intl.DateTimeFormat("ca-ES", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}
