/**
 * Esquemes de les regles.
 *
 * Les condicions es desen com a JSON (`rules.conditions`), de manera que la
 * base de dades no en comprova res: **aquest esquema es l'unica garantia** que
 * el que hi ha desat te la forma que el motor sap llegir.
 */

import { z } from "zod/v4";

import { ruleFieldSchema, ruleOperatorSchema } from "../../db/schema/index.ts";
import { parsejaLlistaEtiquetes } from "../../services/tags.ts";

export const conditionSchema = z.object({
  field: ruleFieldSchema,
  operator: ruleOperatorSchema,
  value: z.string().min(1, "Cal un valor"),
});

export type ConditionInput = z.infer<typeof conditionSchema>;

const idOpcional = z
  .union([z.literal(""), z.coerce.number().int().positive()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/**
 * Alta d'una regla.
 *
 * El formulari envia les condicions com a camps paral·lels
 * (`field[]`, `operator[]`, `value[]`), que es el que fa un formulari HTML amb
 * files repetides; aqui es tornen a ajuntar.
 */
export const ruleCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Cal un nom").max(160, "El nom es massa llarg"),
    priority: z.coerce.number().int().min(0).max(10_000).default(100),
    set_category_id: idOpcional,
    set_tags: z.string().optional().default(""),
    apply_now: z
      .union([z.literal("on"), z.literal("1"), z.literal("true")])
      .optional()
      .transform((v) => v !== undefined),
    field: z.union([z.string(), z.array(z.string())]),
    operator: z.union([z.string(), z.array(z.string())]),
    value: z.union([z.string(), z.array(z.string())]),
  })
  .transform((dades, ctx) => {
    const camps = Array.isArray(dades.field) ? dades.field : [dades.field];
    const operadors = Array.isArray(dades.operator) ? dades.operator : [dades.operator];
    const valors = Array.isArray(dades.value) ? dades.value : [dades.value];

    const condicions: ConditionInput[] = [];
    for (let i = 0; i < camps.length; i += 1) {
      // Una fila del formulari sense valor es una fila que no s'ha omplert.
      if (!(valors[i] ?? "").trim()) continue;
      const provada = conditionSchema.safeParse({
        field: camps[i],
        operator: operadors[i],
        value: (valors[i] ?? "").trim(),
      });
      if (!provada.success) {
        ctx.addIssue({
          code: "custom",
          path: ["conditions"],
          message: "Hi ha una condicio que no es valida",
        });
        continue;
      }
      condicions.push(provada.data);
    }

    if (condicions.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["conditions"],
        message: "Cal com a minim una condicio",
      });
    }

    const etiquetes: string[] = [];
    try {
      etiquetes.push(...parsejaLlistaEtiquetes(dades.set_tags));
    } catch (err) {
      ctx.addIssue({
        code: "custom",
        path: ["set_tags"],
        message: err instanceof Error ? err.message : "Les etiquetes no son valides",
      });
    }

    return {
      name: dades.name,
      priority: dades.priority,
      setCategoryId: dades.set_category_id,
      setTags: etiquetes,
      applyNow: dades.apply_now,
      conditions: condicions,
    };
  });

export type RuleCreateInput = z.infer<typeof ruleCreateSchema>;
