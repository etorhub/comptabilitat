/**
 * Esquemes de les connexions bancaries.
 */

import { z } from "zod/v4";

export const authorizeSchema = z.object({
  aspsp_name: z.string().trim().max(120).default(""),
  aspsp_country: z.string().trim().length(2).default("ES"),
  psu_type: z.enum(["personal", "business"]).default("personal"),
  /** Si ve, es una renovacio del consentiment d'aquesta connexio. */
  connection_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

/** El retorn del banc. No va autenticat: el secret es l'`estat`. */
export const callbackSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const syncSchema = z.object({
  days_back: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(1000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

export const assignSchema = z.object({
  ledger_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .transform((v) => (v === "" ? null : v)),
});
