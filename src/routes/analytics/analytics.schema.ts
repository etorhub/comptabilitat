/**
 * Analytics schemas.
 *
 * Nothing is written here: only the view parameters are validated.
 */

import { z } from "zod/v4";

import { addDays } from "../../lib/time.ts";

export const dashboardSchema = z.object({
  days: z.coerce.number().int().min(7).max(1095).default(180),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

/**
 * The report filters.
 *
 * The keys are the wire format (`des`, `fins`, `mesos`: what the form and
 * `reportFiltersToQuery()` send) and are translated to the code's names in the
 * transform. They were once renamed along with the identifiers, and from then
 * on «Fins a» and «Mesos» were silently ignored.
 */
export const reportFiltersSchema = z
  .object({
    des: isoDate,
    fins: isoDate,
    mesos: z.coerce.number().int().min(1).max(60).default(12),
  })
  .transform(({ des, fins, mesos }) => ({ des, to: fins, months: mesos }));

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export function reportFiltersToQuery(f: ReportFilters): string {
  const p = new URLSearchParams();
  if (f.des) p.set("des", f.des);
  if (f.to) p.set("fins", f.to);
  if (f.months !== 12) p.set("mesos", String(f.months));
  const q = p.toString();
  return q ? `?${q}` : "";
}

/**
 * The dates a report covers: what the filters say, or the last `months`
 * months up to today. The page and both downloads go through here, so what
 * you download is what you are looking at.
 */
export function reportRange(filters: ReportFilters, today: string): [string, string] {
  return [filters.des ?? addDays(today, -filters.months * 31), filters.to ?? today];
}

export const forecastSchema = z.object({
  horitzo: z.coerce.number().int().min(7).max(365).default(90),
});
