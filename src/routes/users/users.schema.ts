/**
 * Esquemes dels usuaris.
 */

import { z } from "zod/v4";

import { ledgerRoleSchema } from "../../db/schema/index.ts";

export const MIN_CONTRASENYA = 10;

export const userCreateSchema = z.object({
  email: z.email("Aixo no sembla una adreça de correu").transform((v) => v.toLowerCase()),
  full_name: z.string().trim().max(255).default(""),
  password: z
    .string()
    .min(MIN_CONTRASENYA, `La contrasenya ha de tenir ${MIN_CONTRASENYA} carácters o mes`),
  is_admin: z
    .union([z.literal("on"), z.literal("1"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

/**
 * Nom i rol d'instal·lacio. L'estat actiu/desactivat es gestiona a
 * `POST /:id/estat`, no aqui: una casella que no ve al cos voldria dir
 * «desmarca't» i esborraria tothom a cada desa.
 */
export const userUpdateSchema = z.object({
  full_name: z.string().trim().max(255).default(""),
  is_admin: z
    .union([z.literal("on"), z.literal("1"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

export const passwordResetSchema = z.object({
  password: z
    .string()
    .min(MIN_CONTRASENYA, `La contrasenya ha de tenir ${MIN_CONTRASENYA} carácters o mes`),
});

/** Concessio d'acces a un espai. `role` buit vol dir treure'l. */
export const grantSchema = z.object({
  ledger_id: z.coerce.number().int().positive(),
  role: z.union([ledgerRoleSchema, z.literal("")]),
});
