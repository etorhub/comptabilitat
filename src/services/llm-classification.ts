/**
 * Classificacio dels comerços desconeguts amb el model local.
 *
 * **El model proposa; no decideix.** El comerç no es dona per confirmat i el
 * moviment queda marcat per revisar fins que ho valida una persona. Cada
 * proposta queda registrada a `llm_suggestions`, tant si s'aplica com si no.
 *
 * Traduccio de `backend/app/services/llm_classification.py`.
 */

import { and, avg, desc, eq, inArray, isNull, ne } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  categories,
  llmSuggestions,
  merchants,
  transactions,
  type Category,
  type Merchant,
} from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { abs, money } from "../lib/money.ts";
import {
  OllamaClient,
  OllamaError,
  type Suggeriment,
} from "../lib/ollama/client.ts";
import { PROMPT_VERSION, type CategoriaCatalog, type ContextComerc } from "../lib/ollama/prompts.ts";

export interface EstadistiquesLlm {
  mirats: number;
  classificats: number;
  pocaConfianca: number;
  errors: number;
  /** Si te text, no s'ha arribat a preguntar res i explica per que. */
  omes: string;
}

function estadistiquesBuides(): EstadistiquesLlm {
  return { mirats: 0, classificats: 0, pocaConfianca: 0, errors: 0, omes: "" };
}

export function resumLlm(s: EstadistiquesLlm): string {
  if (s.omes !== "") return `model local omes: ${s.omes}`;
  return (
    `model local: ${s.mirats} comerços mirats, ${s.classificats} classificats, ` +
    `${s.pocaConfianca} amb poca confiança, ${s.errors} amb error`
  );
}

/**
 * Categories **fulla** d'un espai amb el nom complet, que es el que veu el
 * model. Les de traspas no hi son: un traspas no es cap despesa.
 */
export async function catalegCategories(ledgerId: number): Promise<CategoriaCatalog[]> {
  const files = await db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      slug: categories.slug,
      name: categories.name,
    })
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), ne(categories.kind, "transfer")))
    .orderBy(categories.kind, categories.position);

  const perId = new Map(files.map((c) => [c.id, c]));
  const ambFills = new Set(files.map((c) => c.parentId).filter((id): id is number => id !== null));

  const cataleg: CategoriaCatalog[] = [];
  for (const categoria of files) {
    if (ambFills.has(categoria.id)) continue; // nomes les fulles
    const pare = categoria.parentId === null ? undefined : perId.get(categoria.parentId);
    cataleg.push({
      slug: categoria.slug,
      name: pare ? `${pare.name} > ${categoria.name}` : categoria.name,
    });
  }
  return cataleg;
}

/** Comerços d'un espai sense categoria i que l'usuari no ha confirmat mai. */
export async function comercosPerClassificar(
  ledgerId: number,
  limit: number,
): Promise<Merchant[]> {
  return db
    .select()
    .from(merchants)
    .where(
      and(
        eq(merchants.ledgerId, ledgerId),
        isNull(merchants.defaultCategoryId),
        eq(merchants.isConfirmed, false),
      ),
    )
    .orderBy(desc(merchants.transactionCount))
    .limit(limit);
}

async function construeixContext(comerc: Merchant): Promise<ContextComerc> {
  const mostres = await db
    .select({ description: transactions.description })
    .from(transactions)
    .where(eq(transactions.merchantId, comerc.id))
    .orderBy(desc(transactions.bookingDate))
    .limit(3);

  const [mitjana] = await db
    .select({ valor: avg(transactions.amount) })
    .from(transactions)
    .where(eq(transactions.merchantId, comerc.id));

  const importMitja = money(mitjana?.valor ?? "0");

  return {
    normalizedName: comerc.displayName !== "" ? comerc.displayName : comerc.normalizedName,
    sampleDescriptions: mostres.map((m) => m.description),
    typicalAmount: abs(importMitja).toFixed(2),
    direction: importMitja.greaterThan(0) ? "ingres" : "despesa",
    occurrences: comerc.transactionCount,
  };
}

async function desaSuggeriment(
  comerc: Merchant,
  suggeriment: Suggeriment,
  categoria: Category | undefined,
  context: ContextComerc,
): Promise<void> {
  await db.insert(llmSuggestions).values({
    merchantId: comerc.id,
    model: suggeriment.model,
    promptVersion: suggeriment.promptVersion !== "" ? suggeriment.promptVersion : PROMPT_VERSION,
    inputText: context.normalizedName,
    suggestedCategoryId: categoria?.id ?? null,
    suggestedDisplayName: suggeriment.merchant,
    confidence: suggeriment.confidence,
    rationale: suggeriment.rationale,
    createdAt: new Date(),
  });
}

/**
 * Fa que el model proposi categoria per als comerços desconeguts d'un espai.
 *
 * Es limita a `limit` comerços per passada, els mes freqüents primer: en un
 * NAS sense targeta grafica cada pregunta costa segons, i els comerços amb
 * mes moviments son els que mes revisio estalvien.
 */
export async function classificaComercos(
  ledgerId: number,
  opcions: { client?: OllamaClient; limit?: number } = {},
): Promise<EstadistiquesLlm> {
  const estadistiques = estadistiquesBuides();

  if (!config.ollamaEnabled) {
    estadistiques.omes = "desactivat a la configuracio";
    return estadistiques;
  }

  const pendents = await comercosPerClassificar(ledgerId, opcions.limit ?? 50);
  if (pendents.length === 0) {
    estadistiques.omes = "no hi ha cap comerç nou per mirar";
    return estadistiques;
  }

  const client = opcions.client ?? new OllamaClient();
  if (!(await client.isAvailable())) {
    estadistiques.omes = "el model local no esta disponible";
    return estadistiques;
  }

  const cataleg = await catalegCategories(ledgerId);
  const totes = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
  const perSlug = new Map(totes.map((c) => [c.slug, c]));

  for (const comerc of pendents) {
    estadistiques.mirats += 1;
    const context = await construeixContext(comerc);

    let suggeriment: Suggeriment;
    try {
      suggeriment = await client.classify(context, cataleg);
    } catch (error) {
      if (!(error instanceof OllamaError)) throw error;
      console.warn(`[ollama] no ha pogut classificar ${comerc.normalizedName}: ${error.message}`);
      estadistiques.errors += 1;
      continue;
    }

    const categoria = perSlug.get(suggeriment.categorySlug);
    await desaSuggeriment(comerc, suggeriment, categoria, context);

    if (categoria === undefined) {
      console.info(
        `[ollama] categoria inexistent (${suggeriment.categorySlug}) per a ${comerc.normalizedName}`,
      );
      estadistiques.errors += 1;
      continue;
    }

    if (suggeriment.confidence < config.ollamaMinConfidence) {
      estadistiques.pocaConfianca += 1;
      continue;
    }

    await db
      .update(merchants)
      .set({
        defaultCategoryId: categoria.id,
        categorySource: "llm",
        ...(suggeriment.merchant !== "" ? { displayName: suggeriment.merchant } : {}),
      })
      .where(eq(merchants.id, comerc.id));

    // Es proposa, pero cal que una persona ho validi: `needsReview` a cert.
    await db
      .update(transactions)
      .set({
        categoryId: categoria.id,
        categorySource: "llm",
        categoryConfidence: suggeriment.confidence,
        needsReview: true,
      })
      .where(
        and(
          eq(transactions.merchantId, comerc.id),
          inArray(transactions.categorySource, ["none"]),
        ),
      );

    estadistiques.classificats += 1;
  }

  return estadistiques;
}
