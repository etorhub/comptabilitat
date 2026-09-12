/**
 * Converting Enable Banking's responses into the internal model.
 *
 * The important piece is `dedupKey()`: it is what stops a second sync from
 * duplicating the history. It has to produce **exactly** what the Python one
 * produced, because `transactions.dedup_key` already holds saved values.
 *
 * Translated from `backend/app/integrations/enablebanking/parsing.py`.
 */

import type { TransactionStatus } from "../../db/schema/index.ts";
import { Decimal } from "../money.ts";

/** Statuses the bank can return. The rest (rejected, cancelled) are ignored. */
const STATUS_MAP: Record<string, TransactionStatus> = {
  BOOK: "booked",
  BOOKED: "booked",
  PDNG: "pending",
  PENDING: "pending",
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function decimal(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    return new Decimal(String(value));
  } catch {
    return null;
  }
}

/** A `YYYY-MM-DD` calendar date, or `null`. */
function date(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function firstIdentification(raw: Record<string, unknown>, scheme = "IBAN"): string {
  const accountId = asObject(raw.account_id);
  if (typeof accountId.iban === "string" && accountId.iban) return accountId.iban;

  for (const item of Array.isArray(raw.all_account_ids) ? raw.all_account_ids : []) {
    const obj = asObject(item);
    if (String(obj.scheme_name ?? "").toUpperCase() === scheme) {
      return String(obj.identification ?? "");
    }
  }
  return "";
}

export interface AccountAnalyzed {
  ebAccountUid: string;
  name: string;
  product: string;
  iban: string;
  currency: string;
  cashAccountType: string;
  usage: string;
  raw: Record<string, unknown>;
}

/** An account's fields as they are stored in `accounts`. */
export function parseAccount(raw: Record<string, unknown>): AccountAnalyzed {
  return {
    ebAccountUid: String(raw.uid ?? ""),
    name: String(raw.name ?? raw.details ?? ""),
    product: String(raw.product ?? ""),
    iban: firstIdentification(raw),
    currency: String(raw.currency ?? "EUR"),
    cashAccountType: String(raw.cash_account_type ?? ""),
    usage: String(raw.usage ?? ""),
    raw: raw,
  };
}

export interface BalanceAnalyzed {
  balanceType: string;
  amount: string;
  currency: string;
  referenceDate: string | null;
}

export function parseBalance(raw: Record<string, unknown>): BalanceAnalyzed | null {
  const bulk = asObject(raw.balance_amount);
  const amount = decimal(bulk.amount);
  if (amount === null) return null;

  return {
    balanceType: String(raw.balance_type ?? raw.name ?? "OTHR"),
    amount: amount.toFixed(2),
    currency: String(bulk.currency ?? "EUR"),
    referenceDate: date(raw.reference_date) ?? date(raw.last_change_date_time),
  };
}

function partName(raw: Record<string, unknown>, key: string): string {
  const part = asObject(raw[key]);
  return String(part.name ?? "");
}

function batch(raw: Record<string, unknown>): string {
  const info = raw.remittance_information;
  if (Array.isArray(info)) {
    return info
      .filter(Boolean)
      .map((part) => String(part).trim())
      .join(" ")
      .trim();
  }
  if (typeof info === "string") return info.trim();
  return "";
}

function bankCode(raw: Record<string, unknown>): string {
  const bulk = asObject(raw.bank_transaction_code);
  const parts = [bulk.code, bulk.sub_code].filter(Boolean).map(String);
  return parts.length > 0 ? parts.join("/") : String(bulk.description ?? "");
}

export interface TransactionAnalyzed {
  entryReference: string | null;
  transactionId: string | null;
  bookingDate: string;
  valueDate: string | null;
  /** Signed: negative means money going out. */
  amount: string;
  currency: string;
  status: TransactionStatus;
  description: string;
  counterparty: string;
  bankTransactionCode: string;
  raw: Record<string, unknown>;
}

/**
 * A stable key, so transactions are not duplicated between syncs.
 *
 * When the bank gives an entry reference, it is used as-is. Otherwise a digest
 * is computed over the parts of the transaction that do not change.
 *
 * **It has to match the Python one**: the database already holds saved values,
 * and if this changed, the next sync would duplicate the whole history.
 */
export function dedupKey(transaction: TransactionAnalyzed): string {
  if (transaction.entryReference) {
    return `ref:${transaction.entryReference}`.slice(0, 64);
  }

  const parts = [
    transaction.bookingDate,
    new Decimal(transaction.amount).toFixed(2),
    transaction.currency,
    transaction.description.trim().toLowerCase(),
    transaction.counterparty.trim().toLowerCase(),
  ].join("|");

  const summary = new Bun.CryptoHasher("sha256").update(parts).digest("hex");
  return `h:${summary}`.slice(0, 64);
}

/** Converts a transaction from the API. Returns `null` when it should not be stored. */
export function parseTransaction(raw: Record<string, unknown>): TransactionAnalyzed | null {
  const state = STATUS_MAP[String(raw.status ?? "BOOK").toUpperCase()];
  if (state === undefined) return null;

  const bulk = asObject(raw.transaction_amount);
  let amount = decimal(bulk.amount);
  if (amount === null) return null;

  amount = amount.abs();
  // The bank always gives the amount as a positive number, with the direction separately.
  if (String(raw.credit_debit_indicator ?? "").toUpperCase() !== "CRDT") {
    amount = amount.negated();
  }

  const bookingDate =
    date(raw.booking_date) ?? date(raw.value_date) ?? date(raw.transaction_date);
  if (bookingDate === null) return null;

  const creditor = partName(raw, "creditor");
  const debtor = partName(raw, "debtor");
  // The counterparty is whoever receives the money on an expense and whoever sends it on income.
  const counterparty = amount.isNegative() ? creditor : debtor;

  const parts = [
    batch(raw),
    counterparty,
    String(raw.note ?? ""),
    String(asObject(raw.bank_transaction_code).description ?? ""),
  ];

  const vistos = new Set<string>();
  const description: string[] = [];
  for (const part of parts) {
    const cleaned = part.split(/\s+/).filter(Boolean).join(" ");
    if (cleaned && !vistos.has(cleaned.toLowerCase())) {
      vistos.add(cleaned.toLowerCase());
      description.push(cleaned);
    }
  }

  return {
    entryReference: raw.entry_reference ? String(raw.entry_reference) : null,
    transactionId: raw.transaction_id ? String(raw.transaction_id) : null,
    bookingDate,
    valueDate: date(raw.value_date),
    amount: amount.toFixed(2),
    currency: String(bulk.currency ?? "EUR"),
    status: state,
    description: description.join(" · ").slice(0, 1000),
    counterparty: counterparty.slice(0, 200),
    bankTransactionCode: bankCode(raw).slice(0, 60),
    raw: raw,
  };
}
