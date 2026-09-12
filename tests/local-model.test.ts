/**
 * Classification with the local model.
 *
 * The invariant here: **the model proposes, it does not decide**. What it
 * suggests is applied to the transaction but leaves it marked for review, and
 * it never takes the merchant as confirmed. A port of `test_llm_classification.py`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  ledgers,
  llmSuggestions,
  merchants,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { config } from "../src/lib/config.ts";
import {
  OllamaClient as OllamaClientReal,
  OllamaError,
  type Suggestion,
} from "../src/lib/ollama/client.ts";
import type { CategoryCatalog, MerchantContext } from "../src/lib/ollama/prompts.ts";
import { categoryCatalog, classifyMerchants } from "../src/services/llm-classification.ts";
import { seedCategories } from "../src/services/seed.ts";

/** The `config` is `as const` for the type, but the fields can be touched. */
const ajustos = config as { ollamaEnabled: boolean; ollamaMinConfidence: number };

let ledgerId = 0;
let accountId = 0;

/** A simulated local model, with the same contract as the real client. */
class OllamaFals {
  readonly baseUrl = "http://proves";
  readonly model = "model-de-proves";
  readonly timeoutSeconds = 1;
  readonly asked: string[] = [];

  constructor(
    private readonly respostes: Record<string, Suggestion> = {},
    private readonly disponible = true,
    private readonly falla = false,
  ) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.disponible);
  }

  classify(
    context: MerchantContext,
    _categories: readonly CategoryCatalog[],
  ): Promise<Suggestion> {
    void _categories;
    this.asked.push(context.normalizedName);
    if (this.falla) return Promise.reject(new OllamaError("no respon"));
    const response = this.respostes[context.normalizedName];
    if (response === undefined) return Promise.reject(new OllamaError("sense resposta"));
    return Promise.resolve(response);
  }
}

function asClient(fals: OllamaFals): OllamaClientReal {
  return fals as unknown as OllamaClientReal;
}

function suggestion(parcial: Partial<Suggestion> & { categorySlug: string }): Suggestion {
  return {
    confidence: 0.9,
    merchant: "",
    rationale: "",
    model: "model-de-proves",
    promptVersion: "1",
    ...parcial,
  };
}

async function categoryBySlug(slug: string) {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`falta ${slug}`);
  return c;
}

async function merchantWithTransaction(name: string, amount = "-30.00"): Promise<number> {
  const [merchant] = await db
    .insert(merchants)
    .values({
      ledgerId,
      normalizedName: name,
      displayName: name.charAt(0) + name.slice(1).toLowerCase(),
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 1,
    })
    .returning();

  await db.insert(transactions).values({
    accountId,
    ledgerId,
    dedupKey: `k-${name}`,
    source: "enablebanking",
    bookingDate: "2026-02-01",
    amount,
    currency: "EUR",
    status: "booked",
    description: `COMPRA EN ${name}`,
    normalizedDescription: name,
    counterparty: "",
    bankTransactionCode: "",
    merchantId: merchant?.id ?? 0,
    categorySource: "none",
    needsReview: true,
    notes: "",
    tags: [],
    isExcluded: false,
    raw: {},
  });

  return merchant?.id ?? 0;
}

beforeEach(async () => {
  ajustos.ollamaEnabled = true;
  ajustos.ollamaMinConfidence = 0.55;

  await db.delete(llmSuggestions);
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const [workspace] = await db
    .insert(ledgers)
    .values({
      code: "personal",
      name: "Personal",
      description: "",
      currency: "EUR",
      color: "#2563eb",
      overdraftThreshold: "0.00",
      position: 0,
      isActive: true,
      alertRecipients: [],
    })
    .returning();
  ledgerId = workspace?.id ?? 0;
  await seedCategories(ledgerId);

  const [connection] = await db
    .insert(bankConnections)
    .values({
      name: "P",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      status: "active",
      lastError: "",
    })
    .returning();
  const [account] = await db
    .insert(accounts)
    .values({
      connectionId: connection?.id ?? 0,
      ledgerId,
      ebAccountUid: "uid-llm",
      name: "C",
      product: "",
      iban: "ES00",
      currency: "EUR",
      cashAccountType: "CACC",
      usage: "PRIV",
      isActive: true,
      raw: {},
    })
    .returning();
  accountId = account?.id ?? 0;
});

afterEach(() => {
  ajustos.ollamaEnabled = false;
});

describe("the catalogue the model sees", () => {
  test("carries leaf categories only, and no transfer", async () => {
    const catalog = await categoryCatalog(ledgerId);
    const slugs = new Set(catalog.map((c) => c.slug));

    expect(slugs.has("habitatge-lloguer-o-hipoteca")).toBe(true);
    expect(slugs.has("habitatge")).toBe(false);
    expect([...slugs].some((slug) => slug.startsWith("traspassos"))).toBe(false);
  });
});

describe("the model proposes, it does not decide", () => {
  test("with high confidence it is applied, but left for review", async () => {
    const merchantId = await merchantWithTransaction("MERCADONA");
    const supermercat = await categoryBySlug("alimentacio-supermercat");

    const stats = await classifyMerchants(ledgerId, {
      client: asClient(
        new OllamaFals({
          Mercadona: suggestion({
            categorySlug: "alimentacio-supermercat",
            merchant: "Mercadona",
            rationale: "Cadena de supermercats",
          }),
        }),
      ),
    });

    expect(stats.classificats).toBe(1);

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(merchant?.defaultCategoryId).toBe(supermercat.id);
    expect(merchant?.categorySource).toBe("llm");
    expect(merchant?.isConfirmed).toBe(false);

    const [transaction] = await db.select().from(transactions);
    expect(transaction?.categoryId).toBe(supermercat.id);
    expect(transaction?.categorySource).toBe("llm");
    expect(transaction?.needsReview).toBe(true);
  });

  test("with low confidence it is not applied, but the suggestion is stored", async () => {
    const merchantId = await merchantWithTransaction("COSA RARA");

    const stats = await classifyMerchants(ledgerId, {
      client: asClient(
        new OllamaFals({
          "Cosa rara": suggestion({
            categorySlug: "alimentacio-supermercat",
            confidence: 0.2,
          }),
        }),
      ),
    });

    expect(stats.pocaConfianca).toBe(1);
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(merchant?.defaultCategoryId).toBeNull();
    expect((await db.select().from(llmSuggestions)).length).toBe(1);
  });

  test("a made-up category is not accepted", async () => {
    const merchantId = await merchantWithTransaction("MERCADONA");

    const stats = await classifyMerchants(ledgerId, {
      client: asClient(
        new OllamaFals({
          Mercadona: suggestion({ categorySlug: "categoria-inventada", confidence: 0.99 }),
        }),
      ),
    });

    expect(stats.errors).toBe(1);
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(merchant?.defaultCategoryId).toBeNull();
  });
});

describe("when there is nothing to do or the model is not there", () => {
  test("already confirmed merchants are not looked at again", async () => {
    const merchantId = await merchantWithTransaction("MERCADONA");
    const supermercat = await categoryBySlug("alimentacio-supermercat");
    await db
      .update(merchants)
      .set({ defaultCategoryId: supermercat.id, isConfirmed: true })
      .where(eq(merchants.id, merchantId));

    const fals = new OllamaFals();
    const stats = await classifyMerchants(ledgerId, { client: asClient(fals) });

    expect(fals.asked).toEqual([]);
    expect(stats.omitted).toContain("no hi ha cap comerç nou");
  });

  test("if the model is unavailable nothing breaks", async () => {
    await merchantWithTransaction("MERCADONA");

    const stats = await classifyMerchants(ledgerId, {
      client: asClient(new OllamaFals({}, false)),
    });

    expect(stats.omitted).toContain("no esta disponible");
    const [transaction] = await db.select().from(transactions);
    expect(transaction?.categoryId).toBeNull();
  });

  test("an error from the model does not stop the rest", async () => {
    await merchantWithTransaction("MERCADONA");
    await merchantWithTransaction("NETFLIX", "-12.99");

    const stats = await classifyMerchants(ledgerId, {
      client: asClient(new OllamaFals({}, true, true)),
    });

    expect(stats.mirats).toBe(2);
    expect(stats.errors).toBe(2);
  });

  test("with the model disabled nothing is done", async () => {
    ajustos.ollamaEnabled = false;
    await merchantWithTransaction("MERCADONA");

    const stats = await classifyMerchants(ledgerId, {
      client: asClient(new OllamaFals()),
    });

    expect(stats.omitted).toContain("desactivat");
  });
});

/**
 * The client against a fake server: what in Python was done with `respx`.
 * Only reading the response is tested, not the model.
 */
describe("the Ollama client", () => {
  async function withServer<T>(
    gestor: (req: Request) => Response,
    prova: (baseUrl: string) => Promise<T>,
  ): Promise<T> {
    const server = Bun.serve({ port: 0, fetch: gestor });
    try {
      return await prova(`http://127.0.0.1:${server.port}`);
    } finally {
      await server.stop(true);
    }
  }

  test("reads Ollama's response", async () => {
    await withServer(
      (req) =>
        new URL(req.url).pathname === "/api/tags"
          ? Response.json({ models: [{ name: "qwen3:4b" }] })
          : Response.json({
              message: {
                content: JSON.stringify({
                  category_slug: "alimentacio-supermercat",
                  merchant: "Mercadona",
                  confidence: 0.87,
                  rationale: "supermercat",
                }),
              },
            }),
      async (baseUrl) => {
        const client = new OllamaClientReal({ baseUrl, model: "qwen3:4b" });
        expect(await client.isAvailable()).toBe(true);

        const proposal = await client.classify(
          {
            normalizedName: "Mercadona",
            sampleDescriptions: ["COMPRA EN MERCADONA"],
            typicalAmount: "30.00",
            direction: "despesa",
            occurrences: 4,
          },
          [{ slug: "alimentacio-supermercat", name: "Alimentacio > Supermercat" }],
        );

        expect(proposal.categorySlug).toBe("alimentacio-supermercat");
        expect(proposal.confidence).toBe(0.87);
        expect(proposal.model).toBe("qwen3:4b");
      },
    );
  });

  test("an unreadable response gives an error", async () => {
    await withServer(
      () => Response.json({ message: { content: "no soc json" } }),
      async (baseUrl) => {
        const client = new OllamaClientReal({ baseUrl, model: "qwen3:4b" });
        await expect(
          client.classify(
            {
              normalizedName: "X",
              sampleDescriptions: [],
              typicalAmount: "1.00",
              direction: "despesa",
              occurrences: 1,
            },
            [{ slug: "slug", name: "Nom" }],
          ),
        ).rejects.toThrow(OllamaError);
      },
    );
  });

  test("if the model is missing it is not taken as available", async () => {
    await withServer(
      () => Response.json({ models: [{ name: "llama3.2:3b" }] }),
      async (baseUrl) => {
        expect(await new OllamaClientReal({ baseUrl, model: "qwen3:4b" }).isAvailable()).toBe(
          false,
        );
      },
    );
  });
});
