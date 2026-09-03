/**
 * Dades inicials: espais i pla de categories, en català.
 *
 * Traduccio de `backend/app/services/seed.py`. Els arbres s'han generat a
 * partir d'aquell fitxer per no transcriure vuitanta categories a ma, i els
 * pendents que en surten han de coincidir amb els que ja hi ha desats: la
 * prova de `tests/seed.test.ts` ho comprova.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import { categories, ledgers, type Ledger } from "../db/schema/index.ts";
import type { CategoryKind } from "../db/schema/index.ts";
import { slugify } from "./slugs.ts";

/** [nom del pare, color, [fills]] */
export type Arbre = readonly (readonly [string, string, readonly string[]])[];

export const EXPENSE_TREE: Arbre = [
  [
    "Habitatge",
    "#0ea5e9",
    ["Lloguer o hipoteca", "Comunitat", "IBI i taxes", "Reparacions i obres", "Mobiliari"],
  ],
  [
    "Subministraments",
    "#22d3ee",
    ["Electricitat", "Aigua", "Gas", "Internet i telefon", "Residus"],
  ],
  ["Alimentacio", "#16a34a", ["Supermercat", "Mercat i fruiteria", "Forn i pastisseria"]],
  ["Restauracio", "#f97316", ["Restaurants", "Bars i cafeteries", "Menjar a domicili"]],
  [
    "Transport",
    "#6366f1",
    [
      "Combustible",
      "Peatges i parquing",
      "Transport public",
      "Taxi i VTC",
      "Manteniment del vehicle",
      "Assegurança del vehicle",
      "Impost de circulacio",
    ],
  ],
  ["Salut", "#ef4444", ["Farmacia", "Metge i dentista", "Assegurança medica"]],
  ["Compres", "#a855f7", ["Roba i calçat", "Electronica", "Llar i bricolatge", "Regals"]],
  [
    "Oci i cultura",
    "#ec4899",
    [
      "Subscripcions",
      "Cinema i espectacles",
      "Esport i gimnas",
      "Llibres i premsa",
      "Viatges i vacances",
    ],
  ],
  ["Educacio", "#14b8a6", ["Matricules", "Material escolar", "Formacio"]],
  [
    "Serveis financers",
    "#64748b",
    ["Comissions bancaries", "Interessos i prestecs", "Assegurances", "Inversio"],
  ],
  ["Impostos", "#78716c", ["IRPF", "IVA", "Altres impostos"]],
  ["Persones i familia", "#f59e0b", ["Cura de persones", "Mascotes", "Donacions"]],
  ["Altres despeses", "#94a3b8", ["Efectiu retirat", "Sense classificar"]],
];

export const INCOME_TREE: Arbre = [
  ["Ingressos del treball", "#16a34a", ["Nomina", "Facturacio i autonoms", "Pagues extra"]],
  ["Rendes", "#10b981", ["Lloguers cobrats", "Interessos i dividends"]],
  ["Prestacions", "#34d399", ["Pensions", "Subsidis i ajuts"]],
  ["Altres ingressos", "#4ade80", ["Devolucions", "Vendes", "Ingressos diversos"]],
];

export const TRANSFER_TREE: Arbre = [
  [
    "Traspassos",
    "#8b5cf6",
    ["Traspas entre comptes propis", "Liquidacio de targeta", "Amortitzacio de prestec"],
  ],
];

export const DEFAULT_LEDGERS: readonly (readonly [string, string, string, string])[] = [
  ["personal", "Personal", "#2563eb", "Comptabilitat personal"],
  ["calella", "Calella", "#0891b2", "Comptabilitat de Calella"],
  ["pardals", "Pardals", "#c2410c", "Comptabilitat de Pardals"],
];

/**
 * Crea el pla de categories d'un espai. Es idempotent pel pendent: tornar-ho
 * a cridar no duplica res.
 */
export async function seedCategories(ledgerId: number): Promise<number> {
  const arbres: readonly (readonly [CategoryKind, Arbre])[] = [
    ["expense", EXPENSE_TREE],
    ["income", INCOME_TREE],
    ["transfer", TRANSFER_TREE],
  ];

  const existents = new Set(
    (
      await db
        .select({ slug: categories.slug })
        .from(categories)
        .where(eq(categories.ledgerId, ledgerId))
    ).map((c) => c.slug),
  );

  let creades = 0;
  let posicio = 0;

  for (const [kind, arbre] of arbres) {
    for (const [nomPare, color, fills] of arbre) {
      const slugPare = slugify(nomPare);
      let idPare: number | undefined;

      if (existents.has(slugPare)) {
        const [ja] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slugPare)))
          .limit(1);
        idPare = ja?.id;
      } else {
        const [creat] = await db
          .insert(categories)
          .values({
            ledgerId,
            slug: slugPare,
            name: nomPare,
            kind,
            color,
            icon: "",
            isSystem: true,
            isSubscription: false,
            position: posicio,
            parentId: null,
          })
          .returning({ id: categories.id });
        idPare = creat?.id;
        creades += 1;
      }
      posicio += 1;
      if (idPare === undefined) continue;

      for (const nomFill of fills) {
        const slugFill = `${slugPare}-${slugify(nomFill)}`;
        if (existents.has(slugFill)) continue;
        await db.insert(categories).values({
          ledgerId,
          slug: slugFill,
          name: nomFill,
          kind,
          color,
          icon: "",
          isSystem: true,
          isSubscription: false,
          position: posicio,
          parentId: idPare,
        });
        creades += 1;
        posicio += 1;
      }
    }
  }

  return creades;
}

/** Crea els tres espais inicials amb el seu pla, si no hi son. */
export async function seedLedgers(): Promise<Ledger[]> {
  const creats: Ledger[] = [];

  for (const [posicio, [code, name, color, description]] of DEFAULT_LEDGERS.entries()) {
    const [ja] = await db.select().from(ledgers).where(eq(ledgers.code, code)).limit(1);
    if (ja) {
      await seedCategories(ja.id);
      continue;
    }

    const [creat] = await db
      .insert(ledgers)
      .values({
        code,
        name,
        description,
        currency: "EUR",
        color,
        overdraftThreshold: "0.00",
        position: posicio,
        isActive: true,
        alertRecipients: [],
      })
      .returning();

    if (creat) {
      await seedCategories(creat.id);
      creats.push(creat);
    }
  }

  return creats;
}
