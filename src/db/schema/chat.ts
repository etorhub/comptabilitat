/**
 * The chat at `/e/:codi/xat`.
 *
 * Conversations are private to one user inside one workspace. Nothing here
 * stores `transactions.raw`: a message's `payload` is what the templates draw,
 * already masked by `transactionView()`.
 *
 * An action is an edit the model proposed. Its items keep the state of every row
 * before and after it was applied, which is what makes undo possible and what
 * lets undo notice a row somebody touched afterwards.
 */

import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { domainEnum, timestamps, tz } from "./columns.ts";
import type { ChatActionKind, ChatActionStatus, ChatMessageStatus, ChatRole } from "./enums.ts";
import { ledgers } from "./ledgers.ts";
import { merchants, transactions } from "./transactions.ts";
import { users } from "./users.ts";

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    userId: integer("user_id").notNull(),
    title: varchar({ length: 200 }).notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_chat_conversations", columns: [t.id] }),
    index("ix_chat_conversations_ledger_user").on(t.ledgerId, t.userId),
    foreignKey({
      name: "fk_chat_conversations_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_chat_conversations_user_id_users",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial().notNull(),
    conversationId: integer("conversation_id").notNull(),
    role: domainEnum<ChatRole>().notNull(),
    /** What the person typed; for the assistant, a short plain-text summary. */
    text: text().notNull(),
    status: domainEnum<ChatMessageStatus>().notNull(),
    /** The intent the model chose, after validation. Fed back as context for follow-ups. */
    intent: jsonb().$type<Record<string, unknown>>(),
    /** The structured answer the fragment draws. */
    payload: jsonb().$type<Record<string, unknown>>(),
    model: varchar({ length: 80 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 20 }).notNull(),
    createdAt: tz("created_at").defaultNow().notNull(),
    finishedAt: tz("finished_at"),
  },
  (t) => [
    primaryKey({ name: "pk_chat_messages", columns: [t.id] }),
    index("ix_chat_messages_conversation_id").on(t.conversationId),
    index("ix_chat_messages_status").on(t.status),
    foreignKey({
      name: "fk_chat_messages_conversation_id_chat_conversations",
      columns: [t.conversationId],
      foreignColumns: [chatConversations.id],
    }).onDelete("cascade"),
  ],
);

export const chatActions = pgTable(
  "chat_actions",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    messageId: integer("message_id").notNull(),
    userId: integer("user_id"),
    kind: domainEnum<ChatActionKind>().notNull(),
    /** Resolved parameters plus the transaction ids frozen at proposal time. */
    params: jsonb().notNull().$type<Record<string, unknown>>(),
    status: domainEnum<ChatActionStatus>().notNull(),
    appliedAt: tz("applied_at"),
    undoneAt: tz("undone_at"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_chat_actions", columns: [t.id] }),
    index("ix_chat_actions_ledger_id").on(t.ledgerId),
    unique("uq_chat_actions_message_id").on(t.messageId),
    foreignKey({
      name: "fk_chat_actions_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_chat_actions_message_id_chat_messages",
      columns: [t.messageId],
      foreignColumns: [chatMessages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_chat_actions_user_id_users",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
  ],
);

export const chatActionItems = pgTable(
  "chat_action_items",
  {
    id: serial().notNull(),
    actionId: integer("action_id").notNull(),
    transactionId: integer("transaction_id"),
    merchantId: integer("merchant_id"),
    before: jsonb().notNull().$type<Record<string, unknown>>(),
    after: jsonb().notNull().$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ name: "pk_chat_action_items", columns: [t.id] }),
    index("ix_chat_action_items_action_id").on(t.actionId),
    foreignKey({
      name: "fk_chat_action_items_action_id_chat_actions",
      columns: [t.actionId],
      foreignColumns: [chatActions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_chat_action_items_transaction_id_transactions",
      columns: [t.transactionId],
      foreignColumns: [transactions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_chat_action_items_merchant_id_merchants",
      columns: [t.merchantId],
      foreignColumns: [merchants.id],
    }).onDelete("cascade"),
  ],
);

export type ChatConversation = typeof chatConversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatAction = typeof chatActions.$inferSelect;
export type ChatActionItem = typeof chatActionItems.$inferSelect;
