/**
 * Classificacio amb el model local.
 *
 * La invariant d'aqui: **el model proposa, no decideix**. El que suggereix
 * s'aplica al moviment pero el deixa marcat per revisar, i no dona mai el
 * comerç per confirmat. Port de `backend/tests/test_llm_classification.py`.
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
  type Suggeriment,
} from "../src/lib/ollama/client.ts";
import type { CategoriaCatalog, ContextComerc } from "../src/lib/ollama/prompts.ts";
import { catalegCategories, classificaComercos } from "../src/services/llm-classification.ts";
import { seedCategories } from "../src/services/seed.ts";

/** El `config` es `as const` pel tipus, pero els camps es poden tocar. */
const ajustos = config as { ollamaEnabled: boolean; ollamaMinConfidence: number };

let ledgerId = 0;
let accountId = 0;

/** Model local simulat, amb el mateix contracte que el client de debò. */
class OllamaFals {
  readonly baseUrl = "http://proves";
  readonly model = "model-de-proves";
  readonly timeoutSeconds = 1;
  readonly preguntats: string[] = [];

  constructor(
    private readonly respostes: Record<string, Suggeriment> = {},
    private readonly disponible = true,
    private readonly falla = false,
  ) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.disponible);
  }

  classify(
    context: ContextComerc,
    _categories: readonly CategoriaCatalog[],
  ): Promise<Suggeriment> {
    void _categories;
    this.preguntats.push(context.normalizedName);
    if (this.falla) return Promise.reject(new OllamaError("no respon"));
    const resposta = this.respostes[context.normalizedName];
    if (resposta === undefined) return Promise.reject(new OllamaError("sense resposta"));
    return Promise.resolve(resposta);
  }
}

function comAClient(fals: OllamaFals): OllamaClientReal {
  return fals as unknown as OllamaClientReal;
}

function suggeriment(parcial: Partial<Suggeriment> & { categorySlug: string }): Suggeriment {
  return {
    confidence: 0.9,
    merchant: "",
    rationale: "",
    model: "model-de-proves",
    promptVersion: "1",
    ...parcial,
  };
}

async function categoriaPerSlug(slug: string) {
  const [c] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.slug, slug)))
    .limit(1);
  if (!c) throw new Error(`falta ${slug}`);
  return c;
}

async function comercAmbMoviment(nom: string, amount = "-30.00"): Promise<number> {
  const [comerc] = await db
    .insert(merchants)
    .values({
      ledgerId,
      normalizedName: nom,
      displayName: nom.charAt(0) + nom.slice(1).toLowerCase(),
      categorySource: "none",
      isConfirmed: false,
      transactionCount: 1,
    })
    .returning();

  await db.insert(transactions).values({
    accountId,
    ledgerId,
    dedupKey: `k-${nom}`,
    source: "enablebanking",
    bookingDate: "2026-02-01",
    amount,
    currency: "EUR",
    status: "booked",
    description: `COMPRA EN ${nom}`,
    normalizedDescription: nom,
    counterparty: "",
    bankTransactionCode: "",
    merchantId: comerc?.id ?? 0,
    categorySource: "none",
    needsReview: true,
    notes: "",
    tags: [],
    isExcluded: false,
    raw: {},
  });

  return comerc?.id ?? 0;
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

  const [espai] = await db
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
  ledgerId = espai?.id ?? 0;
  await seedCategories(ledgerId);

  const [connexio] = await db
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
  const [compte] = await db
    .insert(accounts)
    .values({
      connectionId: connexio?.id ?? 0,
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
  accountId = compte?.id ?? 0;
});

afterEach(() => {
  ajustos.ollamaEnabled = false;
});

describe("el cataleg que veu el model", () => {
  test("nomes porta categories fulla, i cap traspas", async () => {
    const cataleg = await catalegCategories(ledgerId);
    const slugs = new Set(cataleg.map((c) => c.slug));

    expect(slugs.has("habitatge-lloguer-o-hipoteca")).toBe(true);
    expect(slugs.has("habitatge")).toBe(false);
    expect([...slugs].some((slug) => slug.startsWith("traspassos"))).toBe(false);
  });
});

describe("el model proposa, no decideix", () => {
  test("amb confiança alta s'aplica, pero queda per revisar", async () => {
    const comercId = await comercAmbMoviment("MERCADONA");
    const supermercat = await categoriaPerSlug("alimentacio-supermercat");

    const estadistiques = await classificaComercos(ledgerId, {
      client: comAClient(
        new OllamaFals({
          Mercadona: suggeriment({
            categorySlug: "alimentacio-supermercat",
            merchant: "Mercadona",
            rationale: "Cadena de supermercats",
          }),
        }),
      ),
    });

    expect(estadistiques.classificats).toBe(1);

    const [comerc] = await db.select().from(merchants).where(eq(merchants.id, comercId));
    expect(comerc?.defaultCategoryId).toBe(supermercat.id);
    expect(comerc?.categorySource).toBe("llm");
    expect(comerc?.isConfirmed).toBe(false);

    const [moviment] = await db.select().from(transactions);
    expect(moviment?.categoryId).toBe(supermercat.id);
    expect(moviment?.categorySource).toBe("llm");
    expect(moviment?.needsReview).toBe(true);
  });

  test("amb poca confiança no s'aplica, pero el suggeriment queda desat", async () => {
    const comercId = await comercAmbMoviment("COSA RARA");

    const estadistiques = await classificaComercos(ledgerId, {
      client: comAClient(
        new OllamaFals({
          "Cosa rara": suggeriment({
            categorySlug: "alimentacio-supermercat",
            confidence: 0.2,
          }),
        }),
      ),
    });

    expect(estadistiques.pocaConfianca).toBe(1);
    const [comerc] = await db.select().from(merchants).where(eq(merchants.id, comercId));
    expect(comerc?.defaultCategoryId).toBeNull();
    expect((await db.select().from(llmSuggestions)).length).toBe(1);
  });

  test("una categoria inventada no s'accepta", async () => {
    const comercId = await comercAmbMoviment("MERCADONA");

    const estadistiques = await classificaComercos(ledgerId, {
      client: comAClient(
        new OllamaFals({
          Mercadona: suggeriment({ categorySlug: "categoria-inventada", confidence: 0.99 }),
        }),
      ),
    });

    expect(estadistiques.errors).toBe(1);
    const [comerc] = await db.select().from(merchants).where(eq(merchants.id, comercId));
    expect(comerc?.defaultCategoryId).toBeNull();
  });
});

describe("quan no hi ha res a fer o el model no hi es", () => {
  test("els comerços ja confirmats no es tornen a mirar", async () => {
    const comercId = await comercAmbMoviment("MERCADONA");
    const supermercat = await categoriaPerSlug("alimentacio-supermercat");
    await db
      .update(merchants)
      .set({ defaultCategoryId: supermercat.id, isConfirmed: true })
      .where(eq(merchants.id, comercId));

    const fals = new OllamaFals();
    const estadistiques = await classificaComercos(ledgerId, { client: comAClient(fals) });

    expect(fals.preguntats).toEqual([]);
    expect(estadistiques.omes).toContain("no hi ha cap comerç nou");
  });

  test("si el model no esta disponible no es trenca res", async () => {
    await comercAmbMoviment("MERCADONA");

    const estadistiques = await classificaComercos(ledgerId, {
      client: comAClient(new OllamaFals({}, false)),
    });

    expect(estadistiques.omes).toContain("no esta disponible");
    const [moviment] = await db.select().from(transactions);
    expect(moviment?.categoryId).toBeNull();
  });

  test("un error del model no atura la resta", async () => {
    await comercAmbMoviment("MERCADONA");
    await comercAmbMoviment("NETFLIX", "-12.99");

    const estadistiques = await classificaComercos(ledgerId, {
      client: comAClient(new OllamaFals({}, true, true)),
    });

    expect(estadistiques.mirats).toBe(2);
    expect(estadistiques.errors).toBe(2);
  });

  test("amb el model desactivat no es fa res", async () => {
    ajustos.ollamaEnabled = false;
    await comercAmbMoviment("MERCADONA");

    const estadistiques = await classificaComercos(ledgerId, {
      client: comAClient(new OllamaFals()),
    });

    expect(estadistiques.omes).toContain("desactivat");
  });
});

/**
 * El client contra un servidor de mentida: el que a Python es feia amb
 * `respx`. Nomes es prova la lectura de la resposta, no el model.
 */
describe("el client d'Ollama", () => {
  async function ambServidor<T>(
    gestor: (req: Request) => Response,
    prova: (baseUrl: string) => Promise<T>,
  ): Promise<T> {
    const servidor = Bun.serve({ port: 0, fetch: gestor });
    try {
      return await prova(`http://127.0.0.1:${servidor.port}`);
    } finally {
      await servidor.stop(true);
    }
  }

  test("interpreta la resposta d'Ollama", async () => {
    await ambServidor(
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

        const proposta = await client.classify(
          {
            normalizedName: "Mercadona",
            sampleDescriptions: ["COMPRA EN MERCADONA"],
            typicalAmount: "30.00",
            direction: "despesa",
            occurrences: 4,
          },
          [{ slug: "alimentacio-supermercat", name: "Alimentacio > Supermercat" }],
        );

        expect(proposta.categorySlug).toBe("alimentacio-supermercat");
        expect(proposta.confidence).toBe(0.87);
        expect(proposta.model).toBe("qwen3:4b");
      },
    );
  });

  test("una resposta il·legible dona error", async () => {
    await ambServidor(
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

  test("si falta el model no es dona per disponible", async () => {
    await ambServidor(
      () => Response.json({ models: [{ name: "llama3.2:3b" }] }),
      async (baseUrl) => {
        expect(await new OllamaClientReal({ baseUrl, model: "qwen3:4b" }).isAvailable()).toBe(
          false,
        );
      },
    );
  });
});
