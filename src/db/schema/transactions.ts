/**
 * Categories, comerços, moviments, regles i suggeriments del model.
 *
 * Van tots en un fitxer perque es referencien en cercle: un moviment apunta a
 * un compte, un espai, un comerç, una categoria i la regla que se li ha
 * aplicat; una regla apunta a la categoria que assigna; un comerç apunta a la
 * seva categoria per defecte. Separar-los obligaria a fer `AnyPgColumn` a
 * gairebé cada clau forana.
 *
 * Tot plegat penja d'un espai: les categories, els comerços i les regles d'un
 * espai no toquen mai els d'un altre.
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
 * Pla de categories de l'espai. Nomes dos nivells: una categoria amb pare no
 * en pot tenir de filles.
 */
export const categories = pgTable(
  "categories",
  {
    id: serial().notNull(),
    ledgerId: integer("ledger_id").notNull(),
    parentId: integer("parent_id"),
    /** Identificador estable dins de l'espai; hi ha codi que en depen. */
    slug: varchar({ length: 80 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    kind: domainEnum<CategoryKind>().notNull(),
    color: varchar({ length: 9 }).notNull(),
    icon: varchar({ length: 40 }).notNull(),
    /** Ve del pla que es crea amb l'espai; no s'esborra alegrement. */
    isSystem: boolean("is_system").notNull(),
    position: integer().notNull(),
    ...timestamps,
    // Afegida per la migracio `a1b2c3d4e5f6`, l'unica columna, a banda de les
    // marques de temps, que porta un valor per defecte a la base de dades.
    isSubscription: boolean("is_subscription").default(false).notNull(),
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
 * Memoria de comerços, **per espai i a proposit**. El mateix Mercadona es un
 * comerç diferent a cada espai: si es compartissin, confirmar una categoria a
 * Calella canviaria com es classifica al Personal, i el nom d'un comerç sovint
 * es el nom d'una persona.
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
    /** Confirmat per una persona: el model ja no el torna a preguntar. */
    isConfirmed: boolean("is_confirmed").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    /** Es una data, no una marca de temps, tot i el nom. */
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
 * Regles de classificacio de l'espai. Les condicions son una llista JSON de
 * `{field, operator, value}` que es compleixen totes alhora.
 */
export const rules = pgTable(
  "rules",
  {
    id: serial().notNull(),
    name: varchar({ length: 160 }).notNull(),
    ledgerId: integer("ledger_id").notNull(),
    /** Numero mes baix, abans. */
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
     * Compte: aqui es CASCADE, no SET NULL. Esborrar una categoria **esborra
     * les regles que l'assignen**, mentre que als moviments nomes els deixa
     * sense categoria. Es aixi a l'esquema viu i s'ha de mantenir.
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
    /** Desnormalitzat del compte per poder filtrar sense fer join. */
    ledgerId: integer("ledger_id"),
    entryReference: varchar("entry_reference", { length: 128 }),
    transactionId: varchar("transaction_id", { length: 128 }),
    /** Clau estable per no duplicar entre sincronitzacions. */
    dedupKey: varchar("dedup_key", { length: 64 }).notNull(),
    source: domainEnum<TransactionSource>().notNull(),
    bookingDate: date("booking_date").notNull(),
    valueDate: date("value_date"),
    /** Amb signe: negatiu = diners que surten. */
    amount: money().notNull(),
    currency: varchar({ length: 3 }).notNull(),
    status: domainEnum<TransactionStatus>().notNull(),
    /** Concepte del banc. Si el moviment esta emmascarat, no ha de sortir. */
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
    /** Aparella les dues potes d'un traspas dins del mateix espai. */
    transferGroupId: varchar("transfer_group_id", { length: 64 }),
    notes: text().notNull(),
    tags: varchar({ length: 40 }).array().notNull(),
    isExcluded: boolean("is_excluded").notNull(),
    /**
     * Resposta sencera del banc: noms, contraparts, referencies. **No es
     * renderitza mai.** Les consultes que alimenten una plantilla han de
     * demanar columnes explicites, no la fila sencera.
     */
    raw: jsonb().notNull().$type<Record<string, unknown>>(),
    ...timestamps,
    /**
     * Afegida per la migracio `b2c3d4e5f6a7`. Quan te valor, el moviment esta
     * **emmascarat**: aquest text substitueix el concepte del banc, i el
     * comerç i la contrapart no es mostren ni es poden cercar. Es una funcio
     * de privadesa i s'aplica a `toTransactionView`, mai a la plantilla.
     */
    displayDescription: varchar("display_description", { length: 200 }),
  },
  (t) => [
    primaryKey({ name: "pk_transactions", columns: [t.id] }),
    index("ix_transactions_account_id").on(t.accountId),
    index("ix_transactions_booking_date").on(t.bookingDate),
    index("ix_transactions_category_id").on(t.categoryId),
    // Sosté la pagina de moviments.
    index("ix_transactions_ledger_booking").on(t.ledgerId, t.bookingDate),
    index("ix_transactions_ledger_id").on(t.ledgerId),
    index("ix_transactions_merchant_id").on(t.merchantId),
    // Sosté la safata de revisio.
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
 * Cada proposta del model local queda registrada, tant si s'aplica com si no.
 * `accepted` te tres estats: `null` = ningu no ho ha revisat encara.
 * Sense `TimestampMixin`.
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
