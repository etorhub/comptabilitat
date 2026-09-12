/**
 * User schemas.
 */

import { z } from "zod/v4";

import { ledgerRoleSchema } from "../../db/schema/index.ts";

export const MIN_PASSWORD = 10;

export const userCreateSchema = z.object({
  email: z.email("Aixo no sembla una adreça de correu").transform((v) => v.toLowerCase()),
  full_name: z.string().trim().max(255).default(""),
  password: z
    .string()
    .min(MIN_PASSWORD, `La contrasenya ha de tenir ${MIN_PASSWORD} carácters o mes`),
  is_admin: z
    .union([z.literal("on"), z.literal("1"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});

/**
 * Name and installation role. The active/inactive state is handled at
 * `POST /:id/estat`, not here: a checkbox missing from the body would mean
 * «untick me» and would deactivate everyone on every save.
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
    .min(MIN_PASSWORD, `La contrasenya ha de tenir ${MIN_PASSWORD} carácters o mes`),
});

/** Granting access to a workspace. An empty `role` means removing it. */
export const grantSchema = z.object({
  ledger_id: z.coerce.number().int().positive(),
  role: z.union([ledgerRoleSchema, z.literal("")]),
});
