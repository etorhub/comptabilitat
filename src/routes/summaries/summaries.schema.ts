/**
 * Schemas of the summaries resource: the written reports.
 *
 * The keys and values are the wire format, so they stay Catalan: `tipus` is
 * `diari` or `mensual`, `periode` is `2026-09-27` or `2026-09`.
 */

import { z } from "zod/v4";

import type { AiReportKind } from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";

export const KIND_FROM_WIRE = { diari: "daily", mensual: "monthly" } as const;
export const KIND_TO_WIRE: Record<AiReportKind, keyof typeof KIND_FROM_WIRE> = {
  daily: "diari",
  monthly: "mensual",
};

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Which report: the kind and its period, checked against each other. */
export const reportRefSchema = z
  .object({
    tipus: z.enum(["diari", "mensual"]),
    periode: z.string().trim(),
  })
  .refine((v) => (v.tipus === "diari" ? DAY : MONTH).test(v.periode), {
    message: "Aquest període no és vàlid",
    path: ["periode"],
  })
  .transform((v) => ({ kind: KIND_FROM_WIRE[v.tipus] as AiReportKind, period: v.periode }));

export type ReportRef = z.infer<typeof reportRefSchema>;

/** Every five seconds: a report takes minutes on a CPU and there is no hurry. */
export const POLL_SECONDS = 5;

/**
 * How long the page waits for one report: the model's timeout, twice, for
 * whatever is queued ahead of it. After that it stops asking and says so.
 */
export function pollAttempts(): number {
  return Math.ceil((config.ollamaReportTimeoutSeconds * 2) / POLL_SECONDS);
}
