/**
 * Validation schemas for sign-in and password change.
 *
 * `users` has no creation form here (that belongs to `routes/users`), so we
 * do not derive the insert schema from it with `drizzle-zod`: what is
 * validated is the form data, which does not match the row.
 */

import { z } from "zod/v4";

/** Password minimum. The same as the Python had. */
export const MIN_PASSWORD = 10;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Cal el correu")
    .email("Aixo no sembla una adreça de correu")
    .toLowerCase(),
  password: z.string().min(1, "Cal la contrasenya"),
  /**
   * Where they wanted to go before we asked them to sign in. Only an internal
   * path is accepted: otherwise this would be an open redirect and would serve
   * to take someone somewhere else from a link that looks like ours.
   */
  desti: z
    .string()
    .optional()
    .transform((v) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/")),
});

export const passwordChangeSchema = z
  .object({
    current_password: z.string().min(1, "Cal la contrasenya actual"),
    new_password: z
      .string()
      .min(MIN_PASSWORD, `La contrasenya nova ha de tenir ${MIN_PASSWORD} carácters o mes`),
    confirm_password: z.string().min(1, "Cal repetir la contrasenya nova"),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Les dues contrasenyes no coincideixen",
    path: ["confirm_password"],
  })
  .refine((d) => d.new_password !== d.current_password, {
    message: "La contrasenya nova ha de ser diferent de l'actual",
    path: ["new_password"],
  });
