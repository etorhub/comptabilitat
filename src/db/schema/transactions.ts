/**
 * Categories, merchants, transactions, rules and the model's suggestions.
 *
 * They live in one file because they reference each other in a cycle: a
 * transaction points at an account, a workspace, a merchant, a category and
 * the rule applied to it; a rule points at the category it assigns; a merchant
 * points at its default category. Splitting them would force `AnyPgColumn` on
 * nearly every foreign key.
 *
 * All of it hangs off a workspace: one workspace's categories, merchants and
 * rules never touch another's.
 */

import {
  boolean,
  date,
  doublePrecision,
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

import { accounts } from "./banking.ts";
import { domainEnum, money, timestamps, tz } from "./columns.ts";
import type {
  CategoryKind,
  CategorySource,
  RuleSource,
  TransactionSource,
  TransactionStatus,
} from "./enums.ts";
import { ledgers } from "./ledgers.ts";
import { users } from "./users.ts";

/**
 * The workspace's category plan. Two levels only: a category with a parent
 * cannot have children of its own.
 */
export const categories = pgTable(
  "categories",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    parentId: integer("parent_id"),
    /** A stable identifier within the workspace; some code depends on it. */
    slug: varchar({ length: 80 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    kind: domainEnum<CategoryKind>().notNull(),
    color: varchar({ length: 9 }).notNull(),
    icon: varchar({ length: 40 }).notNull(),
    /** Comes from the plan created with the workspace; not deleted lightly. */
    isSystem: boolean("is_system").notNull(),
    position: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_categories", columns: [t.id] }),
    index("ix_categories_ledger_id").on(t.ledgerId),
    index("ix_categories_parent_id").on(t.parentId),
    foreignKey({
      name: "fk_categories_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_categories_parent_id_categories",
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete("set null"),
    unique("uq_category_ledger_slug").on(t.ledgerId, t.slug),
  ],
);

/**
 * Merchant (payee) memory, **per workspace and on purpose**. The same
 * Mercadona is a different merchant in each workspace: were they shared,
 * confirming a category in Calella would change how things are classified in
 * Personal.
 *
 * It exists only to infer the default category when importing. It is not an
 * interface resource: there is no Merchants page.
 */
export const merchants = pgTable(
  "merchants",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    normalizedName: varchar("normalized_name", { length: 200 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    defaultCategoryId: integer("default_category_id"),
    categorySource: domainEnum<CategorySource>("category_source").notNull(),
    /** Confirmed by a person: the model does not ask about it again. */
    isConfirmed: boolean("is_confirmed").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    /** A date, not a timestamp, despite the name. */
    lastSeenAt: date("last_seen_at"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_merchants", columns: [t.id] }),
    index("ix_merchants_default_category_id").on(t.defaultCategoryId),
    index("ix_merchants_ledger_id").on(t.ledgerId),
    foreignKey({
      name: "fk_merchants_default_category_id_categories",
      columns: [t.defaultCategoryId],
      foreignColumns: [categories.id],
    }).onDelete("set null"),
    foreignKey({
      name: "fk_merchants_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    unique("uq_merchant_ledger_name").on(t.ledgerId, t.normalizedName),
  ],
);

/**
 * The workspace's classification rules. The conditions are a JSON list of
 * `{field, operator, value}` that all have to hold at once.
 */
export const rules = pgTable(
  "rules",
  {
    id: serial().notNull(),
    name: varchar({ length: 160 }).notNull(),
    ledgerId: integer("ledger_id").notNull(),
    /** Lower number, applied first. */
    priority: integer().notNull(),
    isActive: boolean("is_active").notNull(),
    conditions: jsonb().notNull().$type<unknown>(),
    setCategoryId: integer("set_category_id"),
    setMerchantId: integer("set_merchant_id"),
    setTags: varchar("set_tags", { length: 40 }).array().notNull(),
    source: domainEnum<RuleSource>().notNull(),
    createdById: integer("created_by_id"),
    matchCount: integer("match_count").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "pk_rules", columns: [t.id] }),
    index("ix_rules_ledger_id").on(t.ledgerId),
    foreignKey({
      name: "fk_rules_created_by_id_users",
      columns: [t.createdById],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    foreignKey({
      name: "fk_rules_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("cascade"),
    /**
     * Careful: this is CASCADE, not SET NULL. Deleting a category **deletes
     * the rules that assign it**, while it merely leaves transactions without
     * a category. That is how the live schema is, and it has to stay.
     */
    foreignKey({
      name: "fk_rules_set_category_id_categories",
      columns: [t.setCategoryId],
      foreignColumns: [categories.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_rules_set_merchant_id_merchants",
      columns: [t.setMerchantId],
      foreignColumns: [merchants.id],
    }).onDelete("set null"),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: serial().notNull(),
    accountId: integer("account_id").notNull(),
    /** Denormalised from the account so filtering needs no join. */
    ledgerId: integer("ledger_id"),
    entryReference: varchar("entry_reference", { length: 128 }),
    transactionId: varchar("transaction_id", { length: 128 }),
    /** A stable key, so nothing is duplicated between syncs. */
    dedupKey: varchar("dedup_key", { length: 64 }).notNull(),
    source: domainEnum<TransactionSource>().notNull(),
    bookingDate: date("booking_date").notNull(),
    valueDate: date("value_date"),
    /** Signed: negative means money going out. */
    amount: money().notNull(),
    currency: varchar({ length: 3 }).notNull(),
    status: domainEnum<TransactionStatus>().notNull(),
    /** The bank's description. When the transaction is masked, it must not be shown. */
    description: text().notNull(),
    normalizedDescription: varchar("normalized_description", { length: 200 }).notNull(),
    counterparty: varchar({ length: 200 }).notNull(),
    bankTransactionCode: varchar("bank_transaction_code", { length: 60 }).notNull(),
    merchantId: integer("merchant_id"),
    categoryId: integer("category_id"),
    categorySource: domainEnum<CategorySource>("category_source").notNull(),
    categoryConfidence: doublePrecision("category_confidence"),
    needsReview: boolean("needs_review").notNull(),
    appliedRuleId: integer("applied_rule_id"),
    /** Pairs the two legs of a transfer within the same workspace. */
    transferGroupId: varchar("transfer_group_id", { length: 64 }),
    notes: text().notNull(),
    tags: varchar({ length: 40 }).array().notNull(),
    isExcluded: boolean("is_excluded").notNull(),
    /**
     * The bank's whole response: names, counterparties, references. **Never
     * rendered.** Queries that feed a template must ask for explicit columns,
     * not the whole row.
     */
    raw: jsonb().notNull().$type<Record<string, unknown>>(),
    ...timestamps,
    /**
     * Added by migration `b2c3d4e5f6a7`. When set, the transaction is
     * **masked**: this text replaces the bank's description, and the merchant
     * and counterparty are neither shown nor searchable. It is a privacy
     * feature and is applied in `toTransactionView`, never in the template.
     */
    displayDescription: varchar("display_description", { length: 200 }),
  },
  (t) => [
    primaryKey({ name: "pk_transactions", columns: [t.id] }),
    index("ix_transactions_account_id").on(t.accountId),
    index("ix_transactions_booking_date").on(t.bookingDate),
    index("ix_transactions_category_id").on(t.categoryId),
    // Backs the transactions page.
    index("ix_transactions_ledger_booking").on(t.ledgerId, t.bookingDate),
    index("ix_transactions_ledger_id").on(t.ledgerId),
    index("ix_transactions_merchant_id").on(t.merchantId),
    // Backs the review queue.
    index("ix_transactions_review").on(t.needsReview, t.ledgerId),
    index("ix_transactions_transfer_group_id").on(t.transferGroupId),
    foreignKey({
      name: "fk_transactions_account_id_accounts",
      columns: [t.accountId],
      foreignColumns: [accounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_transactions_applied_rule_id_rules",
      columns: [t.appliedRuleId],
      foreignColumns: [rules.id],
    }).onDelete("set null"),
    foreignKey({
      name: "fk_transactions_category_id_categories",
      columns: [t.categoryId],
      foreignColumns: [categories.id],
    }).onDelete("set null"),
    foreignKey({
      name: "fk_transactions_ledger_id_ledgers",
      columns: [t.ledgerId],
      foreignColumns: [ledgers.id],
    }).onDelete("set null"),
    foreignKey({
      name: "fk_transactions_merchant_id_merchants",
      columns: [t.merchantId],
      foreignColumns: [merchants.id],
    }).onDelete("set null"),
    unique("uq_transaction_account_dedup").on(t.accountId, t.dedupKey),
  ],
);

/**
 * Every proposal from the local model is recorded, whether it is applied or
 * not. `accepted` has three states: `null` = nobody has reviewed it yet. No
 * `TimestampMixin`.
 */
export const llmSuggestions = pgTable(
  "llm_suggestions",
  {
    id: serial().notNull(),
    merchantId: integer("merchant_id"),
    model: varchar({ length: 80 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 20 }).notNull(),
    inputText: text("input_text").notNull(),
    suggestedCategoryId: integer("suggested_category_id"),
    suggestedDisplayName: varchar("suggested_display_name", { length: 200 }).notNull(),
    confidence: doublePrecision(),
    rationale: text().notNull(),
    accepted: boolean(),
    reviewedAt: tz("reviewed_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "pk_llm_suggestions", columns: [t.id] }),
    index("ix_llm_suggestions_merchant_id").on(t.merchantId),
    foreignKey({
      name: "fk_llm_suggestions_merchant_id_merchants",
      columns: [t.merchantId],
      foreignColumns: [merchants.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_llm_suggestions_suggested_category_id_categories",
      columns: [t.suggestedCategoryId],
      foreignColumns: [categories.id],
    }).onDelete("set null"),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Merchant = typeof merchants.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type LlmSuggestion = typeof llmSuggestions.$inferSelect;
