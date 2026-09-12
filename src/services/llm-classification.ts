/**
 * Classification of unknown merchants with the local model.
 *
 * **The model proposes; it does not decide.** The merchant is not taken as
 * confirmed and the transaction stays marked for review until a person
 * validates it. Every proposal is recorded in `llm_suggestions`, whether it
 * is applied or not.
 *
 * A translation of `backend/app/services/llm_classification.py`.
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
  seen: number;
  classified: number;
  lowConfidence: number;
  errors: number;
  /** If it has text, nothing was asked and it explains why. */
  omitted: string;
}

function emptyStats(): LlmStats {
  return { seen: 0, classified: 0, lowConfidence: 0, errors: 0, omitted: "" };
}

export function summaryLlm(s: LlmStats): string {
  if (s.omitted !== "") return `model local omes: ${s.omitted}`;
  return (
    `model local: ${s.seen} comerços mirats, ${s.classified} classificats, ` +
    `${s.lowConfidence} amb poca confiança, ${s.errors} amb error`
  );
}

/**
 * **Leaf** categories of a workspace with the full name, which is what the
 * model sees. The transfer ones are not there: a transfer is not an expense.
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

/** Merchants of a workspace with no category that the user has never confirmed. */
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
  const samples = await db
    .select({ description: transactions.description })
    .from(transactions)
    .where(eq(transactions.merchantId, merchant.id))
    .orderBy(desc(transactions.bookingDate))
    .limit(3);

  const [average] = await db
    .select({ value: avg(transactions.amount) })
    .from(transactions)
    .where(eq(transactions.merchantId, merchant.id));

  const averageAmount = money(average?.value ?? "0");

  return {
    normalizedName:
      merchant.displayName !== "" ? merchant.displayName : merchant.normalizedName,
    sampleDescriptions: samples.map((m) => m.description),
    typicalAmount: abs(averageAmount).toFixed(2),
    direction: averageAmount.greaterThan(0) ? "ingres" : "despesa",
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
 * Makes the model propose a category for a workspace's unknown merchants.
 *
 * It is limited to `limit` merchants per pass, the most frequent first: on a
 * NAS with no graphics card each question costs seconds, and the merchants
 * with the most transactions are the ones that save the most review.
 */
export async function classifyMerchants(
  ledgerId: number,
  options: { client?: OllamaClient; limit?: number } = {},
): Promise<LlmStats> {
  const stats = emptyStats();

  if (!config.ollamaEnabled) {
    stats.omitted = "desactivat a la configuracio";
    return stats;
  }

  const pending = await merchantsToClassify(ledgerId, options.limit ?? 50);
  if (pending.length === 0) {
    stats.omitted = "no hi ha cap comerç nou per mirar";
    return stats;
  }

  const client = options.client ?? new OllamaClient();
  if (!(await client.isAvailable())) {
    stats.omitted = "el model local no esta disponible";
    return stats;
  }

  const catalog = await categoryCatalog(ledgerId);
  const all = await db.select().from(categories).where(eq(categories.ledgerId, ledgerId));
  const perSlug = new Map(all.map((c) => [c.slug, c]));

  for (const merchant of pending) {
    stats.seen += 1;
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
      stats.lowConfidence += 1;
      continue;
    }

    // The two together: if only the first goes through, the merchant says the
    // model gave it a category and its transactions do not have it.
    await db.transaction(async (tx) => {
      await tx
        .update(merchants)
        .set({
          defaultCategoryId: category.id,
          categorySource: "llm",
          ...(suggestion.merchant !== "" ? { displayName: suggestion.merchant } : {}),
        })
        .where(eq(merchants.id, merchant.id));

      // It is proposed, but a person has to validate it: `needsReview` true.
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

    stats.classified += 1;
  }

  return stats;
}
