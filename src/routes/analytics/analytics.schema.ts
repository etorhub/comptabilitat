/**
 * Analytics schemas.
 *
 * Nothing is written here: only the view parameters are validated.
 */

import { z } from "zod/v4";

export const dashboardSchema = z.object({
  days: z.coerce.number().int().min(7).max(1095).default(180),
});

export const reportFiltersSchema = z.object({
  des: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  mesos: z.coerce.number().int().min(1).max(60).default(12),
});

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export function reportFiltersToQuery(f: ReportFilters): string {
  const p = new URLSearchParams();
  if (f.des) p.set("des", f.des);
  if (f.to) p.set("fins", f.to);
  if (f.mesos !== 12) p.set("mesos", String(f.mesos));
  const q = p.toString();
  return q ? `?${q}` : "";
}

export const forecastSchema = z.object({
  horitzo: z.coerce.number().int().min(7).max(365).default(90),
});
