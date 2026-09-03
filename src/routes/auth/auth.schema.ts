/**
 * Esquemes de validacio de l'entrada i del canvi de contrasenya.
 *
 * `users` no te cap formulari de creacio aqui (aixo es de `routes/users`),
 * de manera que no en derivem l'esquema d'inserció amb `drizzle-zod`: el que
 * es valida son les dades del formulari, que no coincideixen amb la fila.
 */

import { z } from "zod";

/** Mínim de la contrasenya. El mateix que tenia el Python. */
export const MIN_CONTRASENYA = 10;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Cal el correu")
    .email("Aixo no sembla una adreça de correu")
    .toLowerCase(),
  password: z.string().min(1, "Cal la contrasenya"),
  /**
   * On volia anar abans que li demanessim que entres. Nomes s'accepta un
   * cami intern: si no, aixo seria una redireccio oberta i serviria per
   * portar algu a un altre lloc des d'un enllaç que sembla nostre.
   */
  desti: z
    .string()
    .optional()
    .transform((v) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/")),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const passwordChangeSchema = z
  .object({
    current_password: z.string().min(1, "Cal la contrasenya actual"),
    new_password: z
      .string()
      .min(MIN_CONTRASENYA, `La contrasenya nova ha de tenir ${MIN_CONTRASENYA} carácters o mes`),
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

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
