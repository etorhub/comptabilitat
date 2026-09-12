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
import { OllamaClient, OllamaError, type Suggestion } from "../lib/ollama/client.ts";
import {
  PROMPT_VERSION,
  type CategoryCatalog,
  type MerchantContext,
} from "../lib/ollama/prompts.ts";

export interface LlmStats {
  mirats: number;
  classificats: number;
  pocaConfianca: number;
  errors: number;
  /** Si te text, no s'ha arribat a preguntar res i explica per que. */
  omes: string;
}

function emptyStats(): LlmStats {
  return { mirats: 0, classificats: 0, pocaConfianca: 0, errors: 0, omes: "" };
}

export function summaryLlm(s: LlmStats): string {
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
export async function categoryCatalog(ledgerId: number): Promise<CategoryCatalog[]> {
  const rows = await db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      slug: categories.slug,
      name: categories.name,
    })
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), ne(categories.kind, "transfer")))
    .orderBy(categories.kind, categories.position);

  const perId = new Map(rows.map((c) => [c.id, c]));
  const withChildren = new Set(
    rows.map((c) => c.parentId).filter((id): id is number => id !== null),
  );

  const catalog: CategoryCatalog[] = [];
  for (const category of rows) {
    if (withChildren.has(category.id)) continue; // nomes les fulles
    const parent = category.parentId === null ? undefined : perId.get(category.parentId);
    catalog.push({
      slug: category.slug,
      name: parent ? `${parent.name} > ${category.name}` : category.name,
    });
  }
  return catalog;
}

/** Comerços d'un espai sense categoria i que l'usuari no ha confirmat mai. */
export async function merchantsToClassify(
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

async function buildContext(merchant: Merchant): Promise<MerchantContext> {
  const mostres = await db
    .select({ description: transactions.description })
    .from(transactions)
    .where(eq(transactions.merchantId, merchant.id))
    .orderBy(desc(transactions.bookingDate))
    .limit(3);

  const [mitjana] = await db
    .select({ valor: avg(transactions.amount) })
    .from(transactions)
    .where(eq(transactions.merchantId, merchant.id));

  const importMitja = money(mitjana?.valor ?? "0");

  return {
    normalizedName:
      merchant.displayName !== "" ? merchant.displayName : merchant.normalizedName,
    sampleDescriptions: mostres.map((m) => m.description),
    typicalAmount: abs(importMitja).toFixed(2),
    direction: importMitja.greaterThan(0) ? "ingres" : "despesa",
    occurrences: merchant.transactionCount,
  };
}

async function saveSuggestion(
  merchant: Merchant,
  suggestion: Suggestion,
  category: Category | undefined,
  context: MerchantContext,
): Promise<void> {
  await db.insert(llmSuggestions).values({
    merchantId: merchant.id,
    model: suggestion.model,
    promptVersion: suggestion.promptVersion !== "" ? suggestion.promptVersion : PROMPT_VERSION,
    inputText: context.normalizedName,
    suggestedCategoryId: category?.id ?? null,
    suggestedDisplayName: suggestion.merchant,
    confidence: suggestion.confidence,
    rationale: suggestion.rationale,
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
export async function classifyMerchants(
  ledgerId: number,
  options: { client?: OllamaClient; limit?: number } = {},
): Promise<LlmStats> {
  const stats = emptyStats();

  if (!config.ollamaEnabled) {
    stats.omes = "desactivat a la configuracio";
    return stats;
  }

  const pending = await merchantsToClassify(ledgerId, options.limit ?? 50);
  if (pending.length === 0) {
    stats.omes = "no hi ha cap comerç nou per mirar";
    return stats;
  }

  const client = options.client ?? new OllamaClient();
  if (!(await client.isAvailable())) {
    stats.omes = "el model local no esta disponible";
    return stats;
  }

  const catalog = await categoryCatalog(ledgerId);
  const all = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
  const perSlug = new Map(all.map((c) => [c.slug, c]));

  for (const merchant of pending) {
    stats.mirats += 1;
    const context = await buildContext(merchant);

    let suggestion: Suggestion;
    try {
      suggestion = await client.classify(context, catalog);
    } catch (error) {
      if (!(error instanceof OllamaError)) throw error;
      console.warn(
        `[ollama] no ha pogut classificar ${merchant.normalizedName}: ${error.message}`,
      );
      stats.errors += 1;
      continue;
    }

    const category = perSlug.get(suggestion.categorySlug);
    await saveSuggestion(merchant, suggestion, category, context);

    if (category === undefined) {
      console.info(
        `[ollama] categoria inexistent (${suggestion.categorySlug}) per a ${merchant.normalizedName}`,
      );
      stats.errors += 1;
      continue;
    }

    if (suggestion.confidence < config.ollamaMinConfidence) {
      stats.pocaConfianca += 1;
      continue;
    }

    // Les dues juntes: si nomes passa la primera, el comerç diu que el model
    // li ha posat una categoria i els seus moviments no la tenen.
    await db.transaction(async (tx) => {
      await tx
        .update(merchants)
        .set({
          defaultCategoryId: category.id,
          categorySource: "llm",
          ...(suggestion.merchant !== "" ? { displayName: suggestion.merchant } : {}),
        })
        .where(eq(merchants.id, merchant.id));

      // Es proposa, pero cal que una persona ho validi: `needsReview` a cert.
      await tx
        .update(transactions)
        .set({
          categoryId: category.id,
          categorySource: "llm",
          categoryConfidence: suggestion.confidence,
          needsReview: true,
        })
        .where(
          and(
            eq(transactions.merchantId, merchant.id),
            inArray(transactions.categorySource, ["none"]),
          ),
        );
    });

    stats.classificats += 1;
  }

  return stats;
}
