/**
 * The chat's write side: propose, apply, undo.
 *
 * **The model never changes anything.** What it asks for becomes a proposal
 * with the rows it would touch, frozen at that moment, and a person applies it.
 *
 * Applying keeps, for every row it touches, the state before and after, inside
 * the same transaction that writes. Undo puts back the «before» — but only on
 * rows that still look like the «after»: a row somebody changed since then is
 * left alone and counted. Only the last action applied in a workspace can be
 * undone: undoing an older one under a newer one would put back states the
 * newer one had already built on.
 */

import { and, count, desc, eq, inArray, ne, not, type SQL } from "drizzle-orm";
import { z } from "zod/v4";

import { db, type Transactor } from "../db/client.ts";
import {
  chatActionItems,
  chatActions,
  chatConversations,
  chatMessages,
  merchants,
  transactions,
  type ChatAction,
  type ChatActionKind,
  type ChatActionStatus,
  categorySourceSchema,
} from "../db/schema/index.ts";
import { AppError, ConflictError, NotFoundError } from "../lib/http.ts";
import { hasNarrowingFilter, type EditIntent } from "./chat-intents.ts";
import {
  describeFilter,
  filterWhere,
  resolveFilter,
  type Answer,
  type Clarification,
  type ListRow,
  type ResolvedFilter,
} from "./chat-queries.ts";
import { hasTag, sameTag, workspaceSpelling } from "./tags.ts";
import { transactionViewsWhere } from "./transactions.ts";

/** More than this in one go is a sign the filter is wrong, not a request. */
export const MAX_ROWS = 5000;
const SAMPLE = 10;

const listRowSchema = z.object({
  id: z.number(),
  bookingDate: z.string(),
  description: z.string(),
  merchantName: z.string().nullable(),
  categoryName: z.string().nullable(),
  amount: z.string(),
  isMasked: z.boolean(),
});

/** What a proposal stores. Read back through this schema, never with a bare cast. */
const paramsSchema = z.object({
  summary: z.string(),
  period: z.string(),
  filter: z.string(),
  transactionIds: z.array(z.number().int()),
  count: z.number().int(),
  /** Rows that already had a note, which this replaces. */
  overwriteCount: z.number().int().default(0),
  /** Rows the filter matched that are already as asked. */
  alreadyCount: z.number().int().default(0),
  sample: z.array(listRowSchema),
  tag: z.string().optional(),
  note: z.string().optional(),
});

export type ActionParams = z.infer<typeof paramsSchema>;

export interface ActionView {
  id: number;
  kind: ChatActionKind;
  status: ChatActionStatus;
  params: ActionParams;
  /** Whether this is the one undo would act on. */
  isLastApplied: boolean;
}

// --- Proposing -------------------------------------------------------------

function clarify(message: string, options: string[] = []): Clarification {
  return { message, options };
}

async function sample(ids: number[]): Promise<ListRow[]> {
  if (ids.length === 0) return [];
  const views = await transactionViewsWhere(
    inArray(transactions.id, ids.slice(0, SAMPLE)),
    "date",
    SAMPLE,
  );
  return views.map((v) => ({
    id: v.id,
    bookingDate: v.bookingDate,
    description: v.description,
    merchantName: v.merchantName,
    categoryName: v.categoryName,
    amount: v.amount,
    isMasked: v.isMasked,
  }));
}

async function candidates(where: SQL | undefined) {
  return db
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      notes: transactions.notes,
    })
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(MAX_ROWS + 1);
}

function tooMany(): Clarification {
  return clarify(
    `Això tocaria més de ${MAX_ROWS} moviments. Afina el filtre (un període, un compte, un text més concret).`,
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function scope(f: ResolvedFilter): string {
  const filter = describeFilter(f);
  return filter ? `${filter} (${f.range.label})` : f.range.label;
}

/**
 * Turns an edit intent into a stored proposal, or into a question back.
 *
 * `messageId` is the assistant message the proposal will be drawn in.
 */
export async function propose(
  ledgerId: number,
  messageId: number,
  intent: EditIntent,
  today: string,
): Promise<Answer | Clarification> {
  if (!hasNarrowingFilter(intent.filter)) {
    return clarify(
      "Per canviar moviments en bloc necessito saber quins: un text, un comerç, una categoria o un compte.",
    );
  }

  const resolved = await resolveFilter(ledgerId, intent.filter, today);
  if (!resolved.ok) return resolved.clarify;
  const f = resolved.value;

  let params: ActionParams;
  switch (intent.kind) {
    case "tag_add":
    case "tag_remove": {
      if (!intent.tag) return clarify("Quina etiqueta?");
      let tag: string;
      try {
        tag = await workspaceSpelling(ledgerId, intent.tag);
      } catch (error) {
        if (error instanceof AppError) return clarify(error.message);
        throw error;
      }
      const base = filterWhere(f, "edit");
      const adding = intent.kind === "tag_add";
      const rows = await candidates(and(base, adding ? not(hasTag(tag)) : hasTag(tag)));
      if (rows.length > MAX_ROWS) return tooMany();
      const [already] = await db
        .select({ n: count() })
        .from(transactions)
        .where(and(base, adding ? hasTag(tag) : not(hasTag(tag))));
      params = {
        summary: adding
          ? `Afegir l'etiqueta «${tag}» a ${plural(rows.length, "moviment", "moviments")} ${scope(f)}.`
          : `Treure l'etiqueta «${tag}» de ${plural(rows.length, "moviment", "moviments")} ${scope(f)}.`,
        period: f.range.label,
        filter: describeFilter(f),
        transactionIds: rows.map((r) => r.id),
        count: rows.length,
        overwriteCount: 0,
        alreadyCount: already?.n ?? 0,
        sample: await sample(rows.map((r) => r.id)),
        tag,
      };
      break;
    }

    case "note_set": {
      if (!intent.note) return clarify("Quina nota hi vols posar?");
      const rows = await candidates(
        and(filterWhere(f, "edit"), ne(transactions.notes, intent.note)),
      );
      if (rows.length > MAX_ROWS) return tooMany();
      params = {
        summary: `Posar la nota «${intent.note}» a ${plural(rows.length, "moviment", "moviments")} ${scope(f)}.`,
        period: f.range.label,
        filter: describeFilter(f),
        transactionIds: rows.map((r) => r.id),
        count: rows.length,
        overwriteCount: rows.filter((r) => r.notes.trim() !== "").length,
        alreadyCount: 0,
        sample: await sample(rows.map((r) => r.id)),
        note: intent.note,
      };
      break;
    }
  }

  if (params.count === 0) {
    return clarify(
      params.alreadyCount > 0
        ? `No hi ha res a canviar: els ${params.alreadyCount} moviments que hi encaixen ja estan així.`
        : "No hi ha cap moviment que hi encaixi.",
    );
  }

  const [action] = await db
    .insert(chatActions)
    .values({ ledgerId, messageId, kind: intent.kind, params, status: "proposed" })
    .returning({ id: chatActions.id });
  if (!action) throw new Error("chat_actions: insert returned nothing");

  return { text: params.summary, payload: { kind: "proposal", actionId: action.id } };
}

// --- Reading ---------------------------------------------------------------

/**
 * An action of this workspace, from a conversation of this user, or 404.
 *
 * Conversations are private: somebody else's proposal is exactly as absent as
 * one that does not exist.
 */
async function ownAction(
  connection: Transactor,
  actionId: number,
  ledgerId: number,
  userId: number,
): Promise<ChatAction> {
  const [row] = await connection
    .select({ action: chatActions })
    .from(chatActions)
    .innerJoin(chatMessages, eq(chatMessages.id, chatActions.messageId))
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .where(
      and(
        eq(chatActions.id, actionId),
        eq(chatActions.ledgerId, ledgerId),
        eq(chatConversations.ledgerId, ledgerId),
        eq(chatConversations.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Aquesta proposta no existeix");
  return row.action;
}

async function lastAppliedId(connection: Transactor, ledgerId: number): Promise<number | null> {
  const [row] = await connection
    .select({ id: chatActions.id })
    .from(chatActions)
    .where(and(eq(chatActions.ledgerId, ledgerId), eq(chatActions.status, "applied")))
    .orderBy(desc(chatActions.appliedAt), desc(chatActions.id))
    .limit(1);
  return row?.id ?? null;
}

function view(action: ChatAction, lastApplied: number | null): ActionView {
  return {
    id: action.id,
    kind: action.kind,
    status: action.status,
    params: paramsSchema.parse(action.params),
    isLastApplied: action.id === lastApplied,
  };
}

export async function actionView(
  actionId: number,
  ledgerId: number,
  userId: number,
): Promise<ActionView> {
  const action = await ownAction(db, actionId, ledgerId, userId);
  return view(action, await lastAppliedId(db, ledgerId));
}

/** The actions drawn in a conversation, by id. The conversation is already known to be the user's. */
export async function actionsOfConversation(
  conversationId: number,
  ledgerId: number,
): Promise<Map<number, ActionView>> {
  const rows = await db
    .select({ action: chatActions })
    .from(chatActions)
    .innerJoin(chatMessages, eq(chatMessages.id, chatActions.messageId))
    .where(
      and(eq(chatMessages.conversationId, conversationId), eq(chatActions.ledgerId, ledgerId)),
    );
  const lastApplied = await lastAppliedId(db, ledgerId);
  return new Map(rows.map((r) => [r.action.id, view(r.action, lastApplied)]));
}

// --- Applying --------------------------------------------------------------

const TRANSACTION_STATE = {
  categoryId: transactions.categoryId,
  categorySource: transactions.categorySource,
  categoryConfidence: transactions.categoryConfidence,
  needsReview: transactions.needsReview,
  tags: transactions.tags,
  notes: transactions.notes,
} as const;

/**
 * A saved state, read back before it is written. It came from our own rows,
 * but it went through JSON on the way, and only these columns may come back.
 */
const transactionStateSchema = z
  .object({
    categoryId: z.number().int().nullable(),
    categorySource: categorySourceSchema,
    categoryConfidence: z.number().nullable(),
    needsReview: z.boolean(),
    tags: z.array(z.string()),
    notes: z.string(),
  })
  .partial()
  .strict();

const merchantStateSchema = z
  .object({
    defaultCategoryId: z.number().int().nullable(),
    categorySource: categorySourceSchema,
    isConfirmed: z.boolean(),
  })
  .partial()
  .strict();

/** `inArray` over an empty list is `false` in Drizzle: no special case needed. */
async function transactionStates(tx: Transactor, ledgerId: number, ids: number[]) {
  const rows = await tx
    .select({ id: transactions.id, ...TRANSACTION_STATE })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.id, ids)));
  return new Map(rows.map((r) => [r.id, r]));
}

async function merchantStates(tx: Transactor, ledgerId: number, ids: number[]) {
  return tx
    .select()
    .from(merchants)
    .where(and(eq(merchants.ledgerId, ledgerId), inArray(merchants.id, ids)));
}

async function saveItems(
  tx: Transactor,
  actionId: number,
  items: {
    transactionId?: number;
    merchantId?: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[],
): Promise<void> {
  // In slices: thousands of rows in a single insert would hit the parameter limit.
  for (let i = 0; i < items.length; i += 500) {
    await tx.insert(chatActionItems).values(
      items.slice(i, i + 500).map((item) => ({
        actionId,
        transactionId: item.transactionId ?? null,
        merchantId: item.merchantId ?? null,
        before: item.before,
        after: item.after,
      })),
    );
  }
}

export interface ApplyResult {
  changed: number;
}

export async function applyAction(
  actionId: number,
  ledgerId: number,
  userId: number,
): Promise<ApplyResult> {
  return db.transaction(async (tx) => {
    const action = await ownAction(tx, actionId, ledgerId, userId);
    if (action.status !== "proposed") {
      throw new ConflictError("Aquesta proposta ja s'ha aplicat");
    }
    const params = paramsSchema.parse(action.params);
    // Rows deleted since the proposal simply drop out.
    const states = await transactionStates(tx, ledgerId, params.transactionIds);
    const ids = [...states.keys()];
    const items: Parameters<typeof saveItems>[2] = [];

    switch (action.kind) {
      case "tag_add":
      case "tag_remove": {
        const tag = params.tag;
        if (tag === undefined) throw new ConflictError("La proposta no diu quina etiqueta");
        for (const [id, state] of states) {
          const current = state.tags;
          const has = current.some((t) => sameTag(t, tag));
          if (action.kind === "tag_add" ? has : !has) continue;
          const next =
            action.kind === "tag_add"
              ? [...current, tag].toSorted()
              : current.filter((t) => !sameTag(t, tag)).toSorted();
          await tx.update(transactions).set({ tags: next }).where(eq(transactions.id, id));
          items.push({ transactionId: id, before: { tags: current }, after: { tags: next } });
        }
        break;
      }

      case "note_set": {
        const note = params.note;
        if (note === undefined) throw new ConflictError("La proposta no diu quina nota");
        if (ids.length > 0) {
          await tx
            .update(transactions)
            .set({ notes: note })
            .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.id, ids)));
        }
        for (const [id, state] of states) {
          items.push({
            transactionId: id,
            before: { notes: state.notes },
            after: { notes: note },
          });
        }
        break;
      }
    }

    await saveItems(tx, action.id, items);
    await tx
      .update(chatActions)
      .set({ status: "applied", appliedAt: new Date(), userId })
      .where(eq(chatActions.id, action.id));

    return { changed: items.filter((i) => i.transactionId !== undefined).length };
  });
}

// --- Undoing ---------------------------------------------------------------

export interface UndoResult {
  restored: number;
  /** Rows changed by somebody since: left as they are. */
  skipped: number;
}

function sameState(
  current: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.keys(expected).every(
    (k) => JSON.stringify(current[k] ?? null) === JSON.stringify(expected[k] ?? null),
  );
}

/** Groups rows that go back to the same state, so one UPDATE covers each group. */
function byState(items: { id: number; before: Record<string, unknown> }[]) {
  const groups = new Map<string, { state: Record<string, unknown>; ids: number[] }>();
  for (const item of items) {
    const key = JSON.stringify(item.before);
    const group = groups.get(key) ?? { state: item.before, ids: [] };
    group.ids.push(item.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function undoAction(
  actionId: number,
  ledgerId: number,
  userId: number,
): Promise<UndoResult> {
  return db.transaction(async (tx) => {
    const action = await ownAction(tx, actionId, ledgerId, userId);
    if (action.status !== "applied") {
      throw new ConflictError("Aquesta proposta no s'ha aplicat, o ja s'ha desfet");
    }
    if ((await lastAppliedId(tx, ledgerId)) !== action.id) {
      throw new ConflictError("Només es pot desfer la darrera acció aplicada en aquest espai");
    }

    const items = await tx
      .select()
      .from(chatActionItems)
      .where(eq(chatActionItems.actionId, action.id));

    let restored = 0;
    let skipped = 0;

    const txItems = items.filter((i) => i.transactionId !== null);
    const states = await transactionStates(
      tx,
      ledgerId,
      txItems.map((i) => i.transactionId ?? 0),
    );
    const toRestore: { id: number; before: Record<string, unknown> }[] = [];
    for (const item of txItems) {
      const current = item.transactionId === null ? undefined : states.get(item.transactionId);
      if (!current || !sameState(current, item.after)) {
        skipped += 1;
        continue;
      }
      toRestore.push({ id: current.id, before: item.before });
    }
    for (const group of byState(toRestore)) {
      await tx
        .update(transactions)
        .set(transactionStateSchema.parse(group.state))
        .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.id, group.ids)));
      restored += group.ids.length;
    }

    const merchantItems = items.filter((i) => i.merchantId !== null);
    const merchantRows = await merchantStates(
      tx,
      ledgerId,
      merchantItems.map((i) => i.merchantId ?? 0),
    );
    for (const item of merchantItems) {
      const current = merchantRows.find((m) => m.id === item.merchantId);
      if (!current || !sameState(current, item.after)) continue;
      await tx
        .update(merchants)
        .set(merchantStateSchema.parse(item.before))
        .where(eq(merchants.id, current.id));
    }

    await tx
      .update(chatActions)
      .set({ status: "undone", undoneAt: new Date() })
      .where(eq(chatActions.id, action.id));

    return { restored, skipped };
  });
}

/** «37 moviments» / «1 moviment», for the confirmations. */
export function movementsText(n: number): string {
  return plural(n, "moviment", "moviments");
}
