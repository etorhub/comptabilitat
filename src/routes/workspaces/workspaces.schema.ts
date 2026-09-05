/**
 * Esquemes dels espais de treball.
 */

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { ledgers } from "../../db/schema/index.ts";

const base = createInsertSchema(ledgers);

export const workspaceCreateSchema = base.pick({ name: true }).extend({
  /** Va a l'adreça (`/e/<codi>`), aixi que nomes lletres, numeros i guions. */
  code: z
    .string()
    .trim()
    .min(1, "Cal un codi")
    .max(50, "El codi es massa llarg")
    .regex(/^[a-z0-9_-]+$/, "Nomes lletres minuscules, numeros, guions i guions baixos"),
  name: z.string().trim().min(1, "Cal un nom").max(120, "El nom es massa llarg"),
  description: z.string().trim().max(500).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "El color ha de ser un codi hexadecimal")
    .default("#2563eb"),
});

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1, "Cal un nom").max(120),
  description: z.string().trim().max(500).default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Color no valid"),
  /**
   * Per sota d'aquest saldo previst salta l'avis. Si un compte te linia de
   * credit, hi va el numero negatiu que correspongui.
   */
  overdraft_threshold: z
    .string()
    .trim()
    .regex(/^-?\d+([.,]\d{1,2})?$/, "Ha de ser un import")
    .transform((v) => v.replace(",", ".")),
  /** Destinataris dels avisos d'aquest espai; buit vol dir els generals. */
  alert_recipients: z
    .string()
    .trim()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.email("Hi ha una adreça que no es valida"))),
});
