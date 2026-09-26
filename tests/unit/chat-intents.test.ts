/**
 * The chat's intents, with no database: what the model said, made safe.
 *
 * The model is small and runs on a CPU. What is checked here is that whatever
 * it gets wrong is dropped rather than guessed, and that the periods mean what
 * the answer says they mean.
 */

import { describe, expect, test } from "bun:test";

import { checkDocument, type RuleName } from "../../htmx-contract/index.ts";
import type { ChatMessage } from "../../src/db/schema/index.ts";
import { buildChatPrompt } from "../../src/lib/ollama/chat-prompts.ts";
import { Message } from "../../src/routes/chat/chat.fragment.ts";
import { pollAttempts } from "../../src/routes/chat/chat.schema.ts";
import {
  addMonths,
  hasNarrowingFilter,
  isEdit,
  previousRange,
  readModelAnswer,
  resolvePeriod,
  toIntent,
} from "../../src/services/chat-intents.ts";

const TODAY = "2026-09-26";

describe("periods", () => {
  test("«el darrer any» is the last twelve months, «l'any passat» the previous calendar year", () => {
    expect(resolvePeriod({ kind: "last_12_months" }, TODAY)).toEqual({
      from: "2025-09-26",
      to: TODAY,
      label: "del 26/09/2025 al 26/09/2026",
    });
    expect(resolvePeriod({ kind: "last_year" }, TODAY)).toMatchObject({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  test("the month-based ones", () => {
    expect(resolvePeriod({ kind: "this_month" }, TODAY)).toMatchObject({
      from: "2026-09-01",
      to: TODAY,
    });
    expect(resolvePeriod({ kind: "last_month" }, TODAY)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(resolvePeriod({ kind: "last_month" }, "2026-01-15")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(resolvePeriod({ kind: "last_30_days" }, TODAY)).toMatchObject({
      from: "2026-08-28",
    });
  });

  test("a year, a custom range the wrong way round, and no period at all", () => {
    expect(resolvePeriod({ kind: "year", year: 2024 }, TODAY)).toMatchObject({
      from: "2024-01-01",
      to: "2024-12-31",
    });
    expect(
      resolvePeriod({ kind: "custom", from: "2026-03-31", to: "2026-03-01" }, TODAY),
    ).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(resolvePeriod({ kind: "all" }, TODAY)).toEqual({
      from: null,
      to: null,
      label: "tot l'historial",
    });
  });

  test("months are clamped to their last day", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonths("2026-01-15", -12)).toBe("2025-01-15");
  });

  test("the period to compare with: the same stretch of the year before, or the same length before", () => {
    const thisYear = resolvePeriod({ kind: "this_year" }, TODAY);
    expect(previousRange(thisYear)).toMatchObject({ from: "2025-01-01", to: "2025-09-26" });

    const lastYear = resolvePeriod({ kind: "last_year" }, TODAY);
    expect(previousRange(lastYear)).toMatchObject({ from: "2024-01-01", to: "2024-12-31" });

    const month = resolvePeriod({ kind: "last_month" }, TODAY);
    expect(previousRange(month)).toMatchObject({ to: "2026-07-31" });

    expect(previousRange(resolvePeriod({ kind: "all" }, TODAY))).toBeNull();
  });
});

describe("what the model says", () => {
  test("a clean answer comes through as it is", () => {
    const answer = readModelAnswer({
      intent: "total",
      text: " glovo ",
      direction: "expense",
      period: "last_12_months",
    });
    expect(answer).toEqual({
      intent: "total",
      text: "glovo",
      direction: "expense",
      period: "last_12_months",
    });
  });

  test("what does not validate is dropped, not guessed", () => {
    const answer = readModelAnswer({
      intent: "delete_everything",
      period: "the_good_old_days",
      date_from: "ahir",
      amount_min: "cent",
      limit: 9999,
      year: 1066,
    });
    expect(answer).toEqual({ intent: "unknown" });
  });

  test("numbers written as text, a comma for decimals, a negative amount", () => {
    const answer = readModelAnswer({
      intent: "list",
      amount_min: "100,5",
      amount_max: -300,
      limit: "10",
    });
    expect(answer).toMatchObject({ amount_min: "100.50", amount_max: "300.00", limit: 10 });
  });

  test("anything that is not an object is nothing", () => {
    expect(readModelAnswer(null)).toBeNull();
    expect(readModelAnswer("total")).toBeNull();
    expect(readModelAnswer([{ intent: "total" }])).toBeNull();
  });
});

describe("the intent", () => {
  test("a query defaults to all history and, for a list, to twenty rows by date", () => {
    const intent = toIntent({ intent: "list" });
    expect(intent).toMatchObject({ kind: "list", orderBy: "date", limit: 20 });
    if (intent.kind !== "list") throw new Error("list");
    expect(intent.filter.period).toEqual({
      kind: "all",
      year: undefined,
      from: undefined,
      to: undefined,
    });
  });

  test("a year on its own becomes that year", () => {
    const intent = toIntent({ intent: "total", year: 2024 });
    if (intent.kind !== "total") throw new Error("total");
    expect(intent.filter.period).toEqual({ kind: "year", year: 2024 });
  });

  test("a merchant rule takes the merchant from `text` when the model put it there", () => {
    const intent = toIntent({
      intent: "merchant_rule",
      text: "glovo",
      target_category: "Menjar a domicili",
    });
    expect(intent).toMatchObject({
      kind: "merchant_rule",
      filter: { merchant: "glovo", text: "" },
      targetCategory: "Menjar a domicili",
    });
    expect(isEdit(intent)).toBe(true);
  });

  test("an edit needs something narrower than a period", () => {
    const loose = toIntent({
      intent: "recategorize",
      period: "this_year",
      target_category: "X",
    });
    const narrow = toIntent({ intent: "recategorize", text: "glovo", target_category: "X" });
    if (loose.kind !== "recategorize" || narrow.kind !== "recategorize")
      throw new Error("edit");
    expect(hasNarrowingFilter(loose.filter)).toBe(false);
    expect(hasNarrowingFilter(narrow.filter)).toBe(true);
    expect(isEdit(toIntent({ intent: "total" }))).toBe(false);
  });
});

describe("the prompt", () => {
  test("carries the workspace's names and the previous turns, and ends on the question", () => {
    const prompt = buildChatPrompt({
      today: TODAY,
      categories: ["Menjar a domicili"],
      accounts: ["Compte corrent"],
      history: [{ question: "quant a glovo?", intent: { intent: "total", text: "glovo" } }],
      question: "i l'any passat?",
    });
    expect(prompt).toContain("Avui és 2026-09-26.");
    expect(prompt).toContain("- Menjar a domicili");
    expect(prompt).toContain("- Compte corrent");
    expect(prompt).toContain('Intenció: {"intent":"total","text":"glovo"}');
    expect(prompt.trimEnd().endsWith("Pregunta: i l'any passat?\nIntenció:")).toBe(true);
  });
});

describe("the answer's poll", () => {
  function pending(): ChatMessage {
    return {
      id: 7,
      conversationId: 3,
      role: "assistant",
      text: "",
      status: "pending",
      intent: null,
      payload: null,
      model: "qwen3:4b",
      promptVersion: "1",
      createdAt: new Date("2026-09-26T10:00:00Z"),
      finishedAt: null,
    };
  }

  async function rules(html: string): Promise<RuleName[]> {
    return (await checkDocument(html, { fragment: true })).map((v) => v.rule);
  }

  const base = { code: "personal", conversationId: 3, actions: new Map(), canEdit: true };

  test("while pending it polls, and the poll is bounded", async () => {
    const html = String(await Message({ ...base, message: pending(), attempt: 0 }));
    expect(html).toContain("hx-trigger=");
    expect(html).toContain(`data-poll-max="${pollAttempts()}"`);
    expect(await rules(html)).not.toContain("unbounded-poll");
  });

  test("when the attempts run out it stops and says so", async () => {
    const html = String(
      await Message({ ...base, message: pending(), attempt: pollAttempts() }),
    );
    expect(html).not.toContain("hx-trigger=");
    expect(html).toContain("S'ha deixat de comprovar");
  });

  test("once answered it carries no trigger", async () => {
    const done = { ...pending(), status: "done" as const, text: "Has gastat 10,00 €." };
    const html = String(await Message({ ...base, message: done, attempt: 3 }));
    expect(html).not.toContain("hx-trigger=");
    expect(html).toContain("Has gastat 10,00 €.");
  });
});
