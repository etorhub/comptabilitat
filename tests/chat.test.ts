/**
 * The chat, end to end, against a local fake of Ollama.
 *
 * What matters here, in order:
 *
 *   1. **The figures come from the database.** The fake model only picks the
 *      filters; the sums on screen have to match the rows.
 *   2. **Nothing is changed without a person applying it**, and the last change
 *      can be undone without trampling on what somebody did since.
 *   3. **Conversations are private and workspaces stay sealed**: somebody
 *      else's conversation or proposal is a 404, like one that does not exist.
 *   4. The answer's poll stops, both when the answer arrives and when it never does.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

import { attributeOf, checkDocument, formatViolations } from "../htmx-contract/index.ts";
import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  chatActions,
  chatConversations,
  chatMessages,
  ledgers,
  merchants,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { config } from "../src/lib/config.ts";
import {
  answerMessage,
  chatQueueIdle,
  failStuckMessages,
  startConversation,
} from "../src/services/chat.ts";
import { OllamaChatModel } from "../src/lib/ollama/client.ts";
import { PASSWORD, requestAs, signIn, type Session } from "./helpers.ts";

/** The `config` is `as const` for the type, but the fields can be touched. */
const settings = config as { ollamaEnabled: boolean; ollamaBaseUrl: string };

// --- The fake model --------------------------------------------------------

/** Question → what the model answers. A question not here gets something unreadable. */
let script: Record<string, unknown> = {};
/** Every prompt the fake received, to check what the model is (and is not) shown. */
let prompts: string[] = [];
let failing = false;

let ollama: ReturnType<typeof Bun.serve> | undefined;

beforeAll(() => {
  ollama = Bun.serve({
    port: 0,
    async fetch(req) {
      if (failing) return new Response("caigut", { status: 500 });
      const body = (await req.json()) as { messages: { content: string }[] };
      const prompt = body.messages[1]?.content ?? "";
      prompts.push(prompt);
      const question = prompt.slice(prompt.lastIndexOf("Pregunta: ") + 10).split("\n")[0] ?? "";
      const answer = script[question.trim()];
      return Response.json({
        message: { content: answer === undefined ? "no soc json" : JSON.stringify(answer) },
      });
    },
  });
});

afterAll(async () => {
  await ollama?.stop(true);
});

// --- The workspace ---------------------------------------------------------

let personalId = 0;
let accountId = 0;
let deliveryId = 0;
let restaurantsId = 0;
let anna: Session;
let maria: Session;
let pere: Session;
let joan: Session;

async function movement(values: {
  description: string;
  amount: string;
  date?: string;
  categoryId?: number | null;
  categorySource?: "none" | "user" | "merchant";
  displayDescription?: string | null;
  merchantId?: number | null;
}): Promise<number> {
  const [row] = await db
    .insert(transactions)
    .values({
      accountId,
      ledgerId: personalId,
      dedupKey: `k-${Math.random()}`,
      source: "enablebanking",
      bookingDate: values.date ?? "2026-06-01",
      amount: values.amount,
      currency: "EUR",
      status: "booked",
      description: values.description,
      normalizedDescription: values.description,
      counterparty: "",
      bankTransactionCode: "",
      merchantId: values.merchantId ?? null,
      categoryId: values.categoryId ?? null,
      categorySource: values.categorySource ?? "none",
      needsReview: values.categorySource !== "user",
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
      displayDescription: values.displayDescription ?? null,
    })
    .returning({ id: transactions.id });
  return row?.id ?? 0;
}

async function category(name: string, slug: string): Promise<number> {
  const [row] = await db
    .insert(categories)
    .values({
      ledgerId: personalId,
      slug,
      name,
      kind: "expense",
      color: "#123456",
      icon: "",
      isSystem: false,
      position: 0,
    })
    .returning({ id: categories.id });
  return row?.id ?? 0;
}

let glovoIds: number[] = [];

beforeEach(async () => {
  settings.ollamaEnabled = true;
  settings.ollamaBaseUrl = `http://127.0.0.1:${ollama?.port ?? 0}`;
  script = {};
  prompts = [];
  failing = false;

  await db.delete(chatConversations);
  await db.delete(transactions);
  await db.delete(merchants);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const workspaces = await db
    .insert(ledgers)
    .values(
      ["personal", "calella"].map((code, i) => ({
        code,
        name: code,
        description: "",
        currency: "EUR",
        color: "#2563eb",
        overdraftThreshold: "0.00",
        position: i,
        isActive: true,
        alertRecipients: [],
      })),
    )
    .returning();
  personalId = workspaces.find((w) => w.code === "personal")?.id ?? 0;
  const calellaId = workspaces.find((w) => w.code === "calella")?.id ?? 0;

  const passwordHash = await hashPassword(PASSWORD);
  const people = await db
    .insert(users)
    .values(
      ["anna", "maria", "pere", "joan"].map((name) => ({
        email: `${name}@exemple.cat`,
        fullName: name,
        passwordHash,
        isAdmin: false,
        isActive: true,
      })),
    )
    .returning();
  const id = (name: string) => people.find((p) => p.fullName === name)?.id ?? 0;
  await db.insert(userLedgerPermissions).values([
    { userId: id("anna"), ledgerId: personalId, role: "editor" },
    { userId: id("maria"), ledgerId: personalId, role: "editor" },
    { userId: id("pere"), ledgerId: personalId, role: "viewer" },
    { userId: id("joan"), ledgerId: calellaId, role: "admin" },
  ]);

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
      ledgerId: personalId,
      ebAccountUid: "uid-xat",
      name: "Compte corrent",
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

  restaurantsId = await category("Restaurants", "restaurants");
  deliveryId = await category("Menjar a domicili", "menjar-a-domicili");

  glovoIds = [
    await movement({ description: "COMPRA GLOVO BARCELONA", amount: "-20.00" }),
    await movement({
      description: "COMPRA GLOVO BARCELONA",
      amount: "-15.50",
      date: "2026-05-10",
    }),
    // Categorised by a person: an explicit order still moves it, and says so.
    await movement({
      description: "COMPRA GLOVO BARCELONA",
      amount: "-10.00",
      categoryId: restaurantsId,
      categorySource: "user",
    }),
  ];
  // Masked: its bank concept says GLOVO, but that must be neither found nor shown.
  await movement({
    description: "COMPRA GLOVO SECRET",
    amount: "-99.00",
    displayDescription: "Sopar amb amics",
  });
  await movement({ description: "COMPRA MERCADONA", amount: "-40.00" });
  await movement({ description: "NOMINA", amount: "1500.00" });

  anna = await signIn("anna@exemple.cat");
  maria = await signIn("maria@exemple.cat");
  pere = await signIn("pere@exemple.cat");
  joan = await signIn("joan@exemple.cat");
});

afterEach(async () => {
  await chatQueueIdle();
  settings.ollamaEnabled = false;
});

// --- Helpers ---------------------------------------------------------------

function form(values: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  };
}

/** Asks a new question and waits for the answer. Returns the conversation's page. */
async function ask(session: Session, question: string): Promise<{ id: number; html: string }> {
  const res = await requestAs(session, "/e/personal/xat", form({ pregunta: question }));
  expect(res.status).toBe(303);
  const location = res.headers.get("location") ?? "";
  const id = Number(location.split("/").pop());
  await chatQueueIdle();
  const page = await requestAs(session, location);
  expect(page.status).toBe(200);
  return { id, html: await page.text() };
}

async function lastAction() {
  const [row] = await db
    .select()
    .from(chatActions)
    .orderBy(sql`${chatActions.id} desc`)
    .limit(1);
  if (!row) throw new Error("no hi ha cap proposta");
  return row;
}

async function htmx(session: Session, url: string): Promise<Response> {
  return requestAs(session, url, { method: "POST", headers: { "HX-Request": "true" } });
}

// --- Asking ----------------------------------------------------------------

describe("asking", () => {
  test("the total comes from the rows, not from the model, and says which dates it used", async () => {
    script["quant he gastat a glovo el darrer any?"] = {
      intent: "total",
      text: "glovo",
      direction: "expense",
      period: "last_12_months",
    };

    const { html } = await ask(anna, "quant he gastat a glovo el darrer any?");

    // 20 + 15.50 + 10: the masked one is not found by its bank concept.
    expect(html).toContain("Has gastat 45,50");
    expect(html).toContain("3 moviments");
    expect(html).toMatch(/del \d\d\/\d\d\/\d{4} al \d\d\/\d\d\/\d{4}/);
    expect(html).toContain("/e/personal/moviments?cerca=glovo");
    expect(formatViolations(await checkDocument(html))).toBe("no violations");
  });

  test("the model never sees a transaction", async () => {
    script["quant he gastat a glovo el darrer any?"] = { intent: "total", text: "glovo" };
    await ask(anna, "quant he gastat a glovo el darrer any?");

    const prompt = prompts.join("\n");
    expect(prompt).toContain("Menjar a domicili");
    expect(prompt).toContain("Compte corrent");
    expect(prompt).not.toContain("BARCELONA");
    expect(prompt).not.toContain("SECRET");
    expect(prompt).not.toContain("45");
  });

  test("a list shows the alias of a masked transaction, never its bank concept", async () => {
    script["ensenya'm les despeses"] = {
      intent: "list",
      direction: "expense",
      order_by: "amount",
    };

    const { html } = await ask(anna, "ensenya'm les despeses");

    expect(html).toContain("Sopar amb amics");
    expect(html).not.toContain("SECRET");
    expect(html).toContain("He trobat 5 moviments");
  });

  test("a breakdown carries its chart as data the server wrote", async () => {
    script["en què he gastat més?"] = { intent: "breakdown", group_by: "category" };

    const { html } = await ask(anna, "en què he gastat més?");

    expect(html).toContain('data-grafic="categories"');
    expect(html).toContain("Sense classificar");
  });

  test("a follow-up is sent with the previous intent", async () => {
    script["quant he gastat a glovo?"] = { intent: "total", text: "glovo" };
    script["i a mercadona?"] = { intent: "total", text: "mercadona" };

    const { id } = await ask(anna, "quant he gastat a glovo?");
    await requestAs(
      anna,
      `/e/personal/xat/${id}/missatges`,
      form({ pregunta: "i a mercadona?" }),
    );
    await chatQueueIdle();

    const last = prompts.at(-1) ?? "";
    expect(last).toContain("Pregunta: quant he gastat a glovo?");
    expect(last).toContain('"text":"glovo"');
  });

  test("a category that does not exist is asked back, not guessed", async () => {
    script["quant he gastat en viatges?"] = { intent: "total", category: "Viatges" };
    const { html } = await ask(anna, "quant he gastat en viatges?");
    expect(html).toContain("No trobo cap categoria que es digui «Viatges»");
  });

  test("an answer the model garbles becomes «I cannot do that», not a guess", async () => {
    const { html } = await ask(anna, "fes-me un poema");
    expect(html).toContain("Això no ho sé fer");
  });

  test("if the model is down, the answer says so and the poll stops", async () => {
    failing = true;
    const { html } = await ask(anna, "quant he gastat?");
    expect(html).toContain("El model local no ha contestat");
    expect(html).not.toContain("hx-trigger");
  });

  test("an empty question comes back as the form, with what was typed and a 422", async () => {
    const res = await requestAs(anna, "/e/personal/xat", {
      ...form({ pregunta: "   " }),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "HX-Request": "true" },
    });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Escriu una pregunta");
    expect(html).toContain('id="conversa"');

    const long = "x".repeat(501);
    const res2 = await requestAs(anna, "/e/personal/xat", form({ pregunta: long }));
    expect(res2.status).toBe(422);
    expect(await res2.text()).toContain(long);
  });

  test("with the model switched off, asking is refused with a notice only", async () => {
    settings.ollamaEnabled = false;
    const res = await htmx(anna, "/e/personal/xat");
    expect(res.status).toBe(409);
    expect(res.headers.get("HX-Reswap")).toBe("none");
  });
});

// --- The poll --------------------------------------------------------------

describe("the answer's poll", () => {
  test("polls while pending, stops when the answer arrives, and gives up when it never does", async () => {
    script["quant he gastat?"] = { intent: "total" };
    const [user] = await db.select().from(users).where(eq(users.email, "anna@exemple.cat"));
    const { conversationId, answerId } = await startConversation(
      personalId,
      user?.id ?? 0,
      "quant he gastat?",
    );
    const url = `/e/personal/xat/${conversationId}/fragment/missatge/${answerId}`;

    const pending = await (await requestAs(anna, url)).text();
    expect(pending).toContain("hx-trigger=");
    expect(pending).toContain("data-poll-max=");
    expect(formatViolations(await checkDocument(pending, { fragment: true }))).toBe(
      "no violations",
    );

    const exhausted = await (await requestAs(anna, `${url}?intent=100000`)).text();
    expect(exhausted).not.toContain("hx-trigger=");
    expect(exhausted).toContain("S'ha deixat de comprovar");

    await answerMessage(answerId, new OllamaChatModel({ baseUrl: settings.ollamaBaseUrl }));
    const done = await (await requestAs(anna, url)).text();
    expect(done).not.toContain("hx-trigger=");
    expect(done).toContain("moviments");
  });

  test("the nightly maintenance closes an answer that will never come", async () => {
    const [user] = await db.select().from(users).where(eq(users.email, "anna@exemple.cat"));
    const { answerId } = await startConversation(personalId, user?.id ?? 0, "hola");
    await db
      .update(chatMessages)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(chatMessages.id, answerId));

    expect(await failStuckMessages(600)).toBe(1);
    const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, answerId));
    expect(message?.status).toBe("error");
  });
});

// --- Proposals -------------------------------------------------------------

const MOVE = "mou tots els moviments que continguin glovo a Menjar a domicili";

async function categoryOf(id: number) {
  const [row] = await db
    .select({ categoryId: transactions.categoryId, source: transactions.categorySource })
    .from(transactions)
    .where(eq(transactions.id, id));
  return row;
}

describe("proposals", () => {
  beforeEach(() => {
    script[MOVE] = {
      intent: "recategorize",
      text: "glovo",
      target_category: "Menjar a domicili",
    };
  });

  test("nothing changes until a person applies it, and it warns about hand-made choices", async () => {
    const { html } = await ask(anna, MOVE);

    expect(html).toContain("Moure 3 moviments");
    expect(html).toContain("classificat tu a mà, i també es mourà");
    expect(html).toContain("/aplica");
    for (const id of glovoIds) expect((await categoryOf(id))?.categoryId).not.toBe(deliveryId);
  });

  test("applying moves the rows, updates the review counter out of band, and undo puts them back", async () => {
    await ask(anna, MOVE);
    const action = await lastAction();

    // From a URL that is not the page holding the counter: the counter still comes back.
    const applied = await htmx(anna, `/e/personal/xat/accions/${action.id}/aplica`);
    expect(applied.status).toBe(200);
    const body = await applied.text();
    expect(await attributeOf(body, "#comptador-revisio", "hx-swap-oob")).toBe("true");
    expect(body).toContain("Aplicat.");
    expect(body).toContain("/desfes");

    for (const id of glovoIds) {
      expect(await categoryOf(id)).toEqual({ categoryId: deliveryId, source: "user" });
    }

    // Somebody changes one of them afterwards: undo must leave that one alone.
    const [touched, ...rest] = glovoIds;
    await db
      .update(transactions)
      .set({ categoryId: restaurantsId })
      .where(eq(transactions.id, touched ?? 0));

    const undone = await htmx(anna, `/e/personal/xat/accions/${action.id}/desfes`);
    expect(undone.status).toBe(200);
    expect(await undone.text()).toContain("s&#39;havien tornat a tocar");

    expect((await categoryOf(touched ?? 0))?.categoryId).toBe(restaurantsId);
    const [first, handMade] = rest;
    expect(await categoryOf(first ?? 0)).toEqual({ categoryId: null, source: "none" });
    expect(await categoryOf(handMade ?? 0)).toEqual({
      categoryId: restaurantsId,
      source: "user",
    });
  });

  test("only the last applied action can be undone", async () => {
    script["afegeix l'etiqueta glovo als de glovo"] = {
      intent: "tag_add",
      text: "glovo",
      tag: "glovo",
    };
    await ask(anna, MOVE);
    const first = await lastAction();
    await ask(anna, "afegeix l'etiqueta glovo als de glovo");
    const second = await lastAction();

    await htmx(anna, `/e/personal/xat/accions/${first.id}/aplica`);
    await htmx(anna, `/e/personal/xat/accions/${second.id}/aplica`);

    const res = await htmx(anna, `/e/personal/xat/accions/${first.id}/desfes`);
    expect(res.status).toBe(409);
    expect(res.headers.get("HX-Reswap")).toBe("none");

    expect((await htmx(anna, `/e/personal/xat/accions/${second.id}/desfes`)).status).toBe(200);
    const [row] = await db
      .select({ tags: transactions.tags })
      .from(transactions)
      .where(eq(transactions.id, glovoIds[0] ?? 0));
    expect(row?.tags).toEqual([]);
  });

  test("an edit with no filter is asked back instead of touching the whole workspace", async () => {
    script["mou-ho tot a Restaurants"] = {
      intent: "recategorize",
      target_category: "Restaurants",
    };
    const { html } = await ask(anna, "mou-ho tot a Restaurants");
    expect(html).toContain("necessito saber quins");
    expect(await db.select().from(chatActions)).toHaveLength(0);
  });

  test("a merchant rule fixes the merchant for the future and leaves hand-made choices", async () => {
    const [merchant] = await db
      .insert(merchants)
      .values({
        ledgerId: personalId,
        normalizedName: "GLOVO",
        displayName: "Glovo",
        categorySource: "none",
        isConfirmed: false,
        transactionCount: 3,
      })
      .returning();
    await db
      .update(transactions)
      .set({ merchantId: merchant?.id ?? 0 })
      .where(
        and(
          eq(transactions.ledgerId, personalId),
          sql`${transactions.description} like '%GLOVO BARCELONA%'`,
        ),
      );

    script["glovo sempre a menjar a domicili"] = {
      intent: "merchant_rule",
      merchant: "glovo",
      target_category: "Menjar a domicili",
    };
    await ask(anna, "glovo sempre a menjar a domicili");
    const action = await lastAction();
    await htmx(anna, `/e/personal/xat/accions/${action.id}/aplica`);

    const [after] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchant?.id ?? 0));
    expect(after?.defaultCategoryId).toBe(deliveryId);
    expect(after?.isConfirmed).toBe(true);
    // The one a person had categorised stays where it was.
    expect((await categoryOf(glovoIds[2] ?? 0))?.categoryId).toBe(restaurantsId);

    await htmx(anna, `/e/personal/xat/accions/${action.id}/desfes`);
    const [restored] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchant?.id ?? 0));
    expect(restored?.defaultCategoryId).toBeNull();
    expect(restored?.isConfirmed).toBe(false);
  });
});

// --- Who sees what ---------------------------------------------------------

describe("who sees what", () => {
  beforeEach(() => {
    script[MOVE] = {
      intent: "recategorize",
      text: "glovo",
      target_category: "Menjar a domicili",
    };
  });

  test("a viewer can ask, but an edit is refused before it becomes a proposal", async () => {
    script["quant he gastat?"] = { intent: "total" };
    expect((await ask(pere, "quant he gastat?")).html).toContain("moviments");

    const { html } = await ask(pere, MOVE);
    expect(html).toContain("Només els editors");
    expect(await db.select().from(chatActions)).toHaveLength(0);
  });

  test("another user's conversation and proposal do not exist for you", async () => {
    const { id } = await ask(anna, MOVE);
    const action = await lastAction();

    // Maria is an editor of the same workspace: still a 404, byte for byte.
    const theirs = await requestAs(maria, `/e/personal/xat/${id}`);
    const missing = await requestAs(maria, `/e/personal/xat/999999`);
    expect(theirs.status).toBe(404);
    expect(await theirs.text()).toBe(await missing.text());

    expect((await htmx(maria, `/e/personal/xat/accions/${action.id}/aplica`)).status).toBe(404);
    expect((await requestAs(maria, "/e/personal/xat")).status).toBe(200);
    expect(await (await requestAs(maria, "/e/personal/xat")).text()).not.toContain(
      MOVE.slice(0, 20),
    );
  });

  test("a viewer cannot apply, and somebody from another workspace gets a 404", async () => {
    await ask(anna, MOVE);
    const action = await lastAction();

    expect((await htmx(pere, `/e/personal/xat/accions/${action.id}/aplica`)).status).toBe(403);
    expect((await requestAs(joan, "/e/personal/xat")).status).toBe(404);
    expect((await htmx(joan, `/e/personal/xat/accions/${action.id}/aplica`)).status).toBe(404);
  });
});
