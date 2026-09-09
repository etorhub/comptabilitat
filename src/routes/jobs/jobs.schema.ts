/**
 * Esquemes de les feines manuals.
 */

import { z } from "zod/v4";

export const FEINES = [
  "passada-diaria",
  "passada-nocturna",
  "sync",
  "classify",
  "llm",
  "analyze",
  "notify",
  "notify-urgents",
  "maintenance",
  "totes",
] as const;

export type FeinaId = (typeof FEINES)[number];

export const feinaSchema = z.object({
  feina: z.enum(FEINES),
});
