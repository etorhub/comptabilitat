/**
 * The chat: conversations, messages and the queue that answers them.
 *
 * A question is saved together with an empty assistant message (`pending`), and
 * the page polls that message until it is `done` or `error`. The answer is
 * written in the background, one at a time: on a NAS with no graphics card two
 * calls at once only make both slower.
 *
 * Conversations are private: one user, one workspace. Every lookup here takes
 * both, and somebody else's conversation is a 404, like one that does not exist.
 */

import { and, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  chatConversations,
  chatMessages,
  roleAtLeast,
  userLedgerPermissions,
  type ChatConversation,
  type ChatMessage,
} from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { ConflictError, NotFoundError } from "../lib/http.ts";
import {
  buildChatPrompt,
  CHAT_PROMPT_VERSION,
  CHAT_RESPONSE_SCHEMA,
  CHAT_SYSTEM_PROMPT,
  type ChatTurn,
} from "../lib/ollama/chat-prompts.ts";
import { OllamaChatModel, OllamaError, type ChatModel } from "../lib/ollama/client.ts";
import { todayLocal } from "../lib/time.ts";
import { propose } from "./chat-actions.ts";
import { isEdit, readModelAnswer, toIntent, type Intent } from "./chat-intents.ts";
import {
  accountNames,
  answerBreakdown,
  answerCompare,
  answerList,
  answerSeries,
  answerTotal,
  categoryCatalog,
  resolveFilter,
  type Answer,
  type AnswerPayload,
  type Clarification,
} from "./chat-queries.ts";

export const MAX_QUESTION = 500;
const HISTORY_TURNS = 3;

// --- Conversations ---------------------------------------------------------

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: Date;
}

export async function listConversations(
  ledgerId: number,
  userId: number,
): Promise<ConversationSummary[]> {
  return db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .where(and(eq(chatConversations.ledgerId, ledgerId), eq(chatConversations.userId, userId)))
    .orderBy(desc(chatConversations.updatedAt), desc(chatConversations.id))
    .limit(100);
}

export async function conversationOf(
  id: number,
  ledgerId: number,
  userId: number,
): Promise<ChatConversation> {
  const [row] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, id),
        eq(chatConversations.ledgerId, ledgerId),
        eq(chatConversations.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Aquesta conversa no existeix");
  return row;
}

export async function messagesOf(conversationId: number): Promise<ChatMessage[]> {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.id);
}

/** A message of a conversation the caller has already checked is theirs, or 404. */
export async function messageOf(
  messageId: number,
  conversationId: number,
): Promise<ChatMessage> {
  const [row] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.conversationId, conversationId)))
    .limit(1);
  if (!row) throw new NotFoundError("Aquest missatge no existeix");
  return row;
}

function titleFrom(question: string): string {
  const clean = question.trim().replace(/\s+/g, " ");
  return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
}

/** Saves the question and the empty answer. Returns the answer's id, to be queued. */
async function saveQuestion(conversationId: number, question: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.insert(chatMessages).values({
      conversationId,
      role: "user",
      text: question,
      status: "done",
      model: "",
      promptVersion: "",
      finishedAt: new Date(),
    });
    const [answer] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        role: "assistant",
        text: "",
        status: "pending",
        model: config.ollamaChatModel,
        promptVersion: CHAT_PROMPT_VERSION,
      })
      .returning({ id: chatMessages.id });
    await tx
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversations.id, conversationId));
    if (!answer) throw new Error("chat_messages: insert returned nothing");
    return answer.id;
  });
}

export async function startConversation(
  ledgerId: number,
  userId: number,
  question: string,
): Promise<{ conversationId: number; answerId: number }> {
  const [conversation] = await db
    .insert(chatConversations)
    .values({ ledgerId, userId, title: titleFrom(question) })
    .returning({ id: chatConversations.id });
  if (!conversation) throw new Error("chat_conversations: insert returned nothing");
  const answerId = await saveQuestion(conversation.id, question);
  return { conversationId: conversation.id, answerId };
}

/** One question at a time per conversation: a follow-up needs the previous answer. */
export async function askInConversation(
  conversationId: number,
  question: string,
): Promise<number> {
  const [pending] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(
      and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.status, "pending")),
    )
    .limit(1);
  if (pending) throw new ConflictError("Espera que acabi la resposta anterior");
  return saveQuestion(conversationId, question);
}

export async function deleteConversation(id: number, ledgerId: number, userId: number) {
  await conversationOf(id, ledgerId, userId);
  await db.delete(chatConversations).where(eq(chatConversations.id, id));
}

// --- The queue -------------------------------------------------------------

let queue: Promise<void> = Promise.resolve();

/** Answers the message in the background, after whatever is already queued. */
export function enqueueAnswer(messageId: number, model?: ChatModel): Promise<void> {
  const run = queue.then(() => answerMessage(messageId, model));
  queue = run.catch((error: unknown) => {
    console.error("[xat] la resposta ha fallat:", error);
  });
  return queue;
}

/** Resolves once everything queued so far is answered. For tests and for shutting down. */
export function chatQueueIdle(): Promise<void> {
  return queue;
}

// --- Answering -------------------------------------------------------------

const EXAMPLES = [
  "Quant he gastat a Glovo el darrer any?",
  "En què he gastat més aquest any?",
  "Ensenya'm els moviments de més de 100 € del mes passat",
  "Mou tots els moviments que continguin glovo a Menjar a domicili",
];

function clarification(c: Clarification): Answer {
  return { text: c.message, payload: { kind: "clarify", options: c.options } };
}

function isClarification(value: Answer | Clarification): value is Clarification {
  return "message" in value;
}

/** The last few exchanges, so «i l'any passat?» knows what it follows. */
async function history(conversationId: number, beforeId: number): Promise<ChatTurn[]> {
  const rows = await db
    .select({ role: chatMessages.role, text: chatMessages.text, intent: chatMessages.intent })
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), lt(chatMessages.id, beforeId)))
    .orderBy(desc(chatMessages.id))
    .limit(HISTORY_TURNS * 2);

  const turns: ChatTurn[] = [];
  const ordered = rows.toReversed();
  for (let i = 0; i + 1 < ordered.length; i++) {
    const question = ordered[i];
    const answer = ordered[i + 1];
    if (question?.role === "user" && answer?.role === "assistant" && answer.intent) {
      turns.push({ question: question.text, intent: answer.intent });
      i++;
    }
  }
  return turns;
}

async function roleIn(ledgerId: number, userId: number) {
  const [row] = await db
    .select({ role: userLedgerPermissions.role })
    .from(userLedgerPermissions)
    .where(
      and(
        eq(userLedgerPermissions.ledgerId, ledgerId),
        eq(userLedgerPermissions.userId, userId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

async function finish(
  messageId: number,
  values: {
    status: "done" | "error";
    text: string;
    payload: AnswerPayload | null;
    intent?: Record<string, unknown> | null;
    model?: string;
  },
): Promise<void> {
  await db
    .update(chatMessages)
    .set({
      status: values.status,
      text: values.text,
      payload: values.payload,
      intent: values.intent ?? null,
      ...(values.model === undefined ? {} : { model: values.model }),
      finishedAt: new Date(),
    })
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.status, "pending")));
}

/**
 * Writes the answer to one pending assistant message.
 *
 * Never throws: whatever happens ends as `done` or `error` on the message, so
 * the page's poll always has something to stop on.
 */
export async function answerMessage(
  messageId: number,
  model: ChatModel = new OllamaChatModel(),
  today: string = todayLocal(),
): Promise<void> {
  try {
    const [row] = await db
      .select({ message: chatMessages, conversation: chatConversations })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
      .where(eq(chatMessages.id, messageId))
      .limit(1);
    if (!row || row.message.status !== "pending") return;
    const { ledgerId, userId } = row.conversation;

    const [question] = await db
      .select({ id: chatMessages.id, text: chatMessages.text })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, row.conversation.id),
          eq(chatMessages.role, "user"),
          lt(chatMessages.id, messageId),
        ),
      )
      .orderBy(desc(chatMessages.id))
      .limit(1);
    if (!question) {
      await finish(messageId, {
        status: "error",
        text: "No hi ha cap pregunta.",
        payload: null,
      });
      return;
    }

    // Access can be taken away between the question and the answer.
    const role = await roleIn(ledgerId, userId);
    if (role === null) {
      await finish(messageId, {
        status: "error",
        text: "Ja no tens accés a aquest espai.",
        payload: null,
      });
      return;
    }

    const [categories, accounts, turns] = await Promise.all([
      categoryCatalog(ledgerId),
      accountNames(ledgerId),
      history(row.conversation.id, question.id),
    ]);

    const raw = await model.interpret(
      CHAT_SYSTEM_PROMPT,
      buildChatPrompt({
        today,
        categories: categories.map((c) => c.fullName),
        accounts: accounts.map((a) => a.name),
        history: turns,
        question: question.text,
      }),
      CHAT_RESPONSE_SCHEMA,
    );

    const said = readModelAnswer(raw);
    const intent: Intent = said === null ? { kind: "unknown" } : toIntent(said);
    const answer = await execute(
      ledgerId,
      messageId,
      intent,
      today,
      roleAtLeast(role, "editor"),
    );

    await finish(messageId, {
      status: "done",
      text: answer.text,
      payload: answer.payload,
      intent: said,
      model: model.model,
    });
  } catch (error) {
    console.error("[xat] no s'ha pogut respondre:", error);
    await finish(messageId, {
      status: "error",
      text:
        error instanceof OllamaError
          ? "El model local no ha contestat. Torna-ho a provar d'aquí a una estona."
          : "No he pogut respondre per un error inesperat.",
      payload: null,
    });
  }
}

async function execute(
  ledgerId: number,
  messageId: number,
  intent: Intent,
  today: string,
  canEdit: boolean,
): Promise<Answer> {
  if (intent.kind === "unknown") {
    return {
      text: `Això no ho sé fer. Prova, per exemple: «${EXAMPLES.join("», «")}».`,
      payload: { kind: "unknown" },
    };
  }

  if (isEdit(intent)) {
    if (!canEdit) {
      return {
        text: "Només els editors poden fer canvis en aquest espai. Et puc respondre preguntes.",
        payload: { kind: "forbidden" },
      };
    }
    const proposal = await propose(ledgerId, messageId, intent, today);
    return isClarification(proposal) ? clarification(proposal) : proposal;
  }

  const resolved = await resolveFilter(ledgerId, intent.filter, today);
  if (!resolved.ok) return clarification(resolved.clarify);
  const f = resolved.value;

  switch (intent.kind) {
    case "total":
      return answerTotal(f);
    case "list":
      return answerList(f, intent.orderBy, intent.limit);
    case "breakdown":
      return answerBreakdown(f, intent.groupBy, intent.limit);
    case "series":
      return answerSeries(f);
    case "compare": {
      const result = await answerCompare(f, intent.other, today);
      return isClarification(result) ? clarification(result) : result;
    }
    default:
      return { text: "Això no ho sé fer.", payload: { kind: "unknown" } };
  }
}

/**
 * Answers that will never arrive.
 *
 * The queue lives in the web process: if it restarts, whatever was pending is
 * orphaned. At startup nothing can be in flight, so everything pending goes;
 * the nightly maintenance catches the rest by age.
 */
export async function failStuckMessages(olderThanSeconds: number): Promise<number> {
  const rows = await db
    .update(chatMessages)
    .set({
      status: "error",
      text: "La resposta s'ha interromput. Torna a fer la pregunta.",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(chatMessages.status, "pending"),
        lt(chatMessages.createdAt, sql`now() - make_interval(secs => ${olderThanSeconds})`),
      ),
    )
    .returning({ id: chatMessages.id });
  return rows.length;
}
