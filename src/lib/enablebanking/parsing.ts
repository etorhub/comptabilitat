/**
 * Conversio de les respostes d'Enable Banking al model intern.
 *
 * La peça important es `dedupKey()`: es el que fa que sincronitzar dues
 * vegades no dupliqui l'historic. Ha de donar **exactament** el mateix que la
 * de Python, perque a `transactions.dedup_key` ja n'hi ha de desades.
 *
 * Traduccio de `backend/app/integrations/enablebanking/parsing.py`.
 */

import type { TransactionStatus } from "../../db/schema/index.ts";
import { Decimal } from "../money.ts";

/** Estats que pot tornar el banc. La resta (rebutjats, cancel·lats) s'ignoren. */
const STATUS_MAP: Record<string, TransactionStatus> = {
  BOOK: "booked",
  BOOKED: "booked",
  PDNG: "pending",
  PENDING: "pending",
};

function asObject(valor: unknown): Record<string, unknown> {
  return typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};
}

function decimal(valor: unknown): Decimal | null {
  if (valor === null || valor === undefined) return null;
  try {
    return new Decimal(String(valor));
  } catch {
    return null;
  }
}

/** Data de calendari `AAAA-MM-DD`, o `null`. */
function date(valor: unknown): string | null {
  if (!valor) return null;
  const text = String(valor).slice(0, 10);
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

/** Camps d'un compte tal com els desem a `accounts`. */
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
  const quantitat = decimal(bulk.amount);
  if (quantitat === null) return null;

  return {
    balanceType: String(raw.balance_type ?? raw.name ?? "OTHR"),
    amount: quantitat.toFixed(2),
    currency: String(bulk.currency ?? "EUR"),
    referenceDate: date(raw.reference_date) ?? date(raw.last_change_date_time),
  };
}

function partName(raw: Record<string, unknown>, key: string): string {
  const part = asObject(raw[key]);
  return String(part.name ?? "");
}

function remesa(raw: Record<string, unknown>): string {
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

function codiBank(raw: Record<string, unknown>): string {
  const bulk = asObject(raw.bank_transaction_code);
  const parts = [bulk.code, bulk.sub_code].filter(Boolean).map(String);
  return parts.length > 0 ? parts.join("/") : String(bulk.description ?? "");
}

export interface TransactionAnalyzed {
  entryReference: string | null;
  transactionId: string | null;
  bookingDate: string;
  valueDate: string | null;
  /** Amb signe: negatiu = diners que surten. */
  amount: string;
  currency: string;
  status: TransactionStatus;
  description: string;
  counterparty: string;
  bankTransactionCode: string;
  raw: Record<string, unknown>;
}

/**
 * Clau estable per no duplicar moviments entre sincronitzacions.
 *
 * Si el banc dona una referencia d'apunt, es fa servir tal qual. Si no, es
 * calcula un resum de les dades que no canvien del moviment.
 *
 * **Ha de coincidir amb la de Python**: a la base de dades ja n'hi ha de
 * desades, i si canviés, la propera sincronitzacio duplicaria tot l'historic.
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

/** Converteix un moviment de l'API. Retorna `null` si no s'ha de desar. */
export function parseTransaction(raw: Record<string, unknown>): TransactionAnalyzed | null {
  const state = STATUS_MAP[String(raw.status ?? "BOOK").toUpperCase()];
  if (state === undefined) return null;

  const bulk = asObject(raw.transaction_amount);
  let quantitat = decimal(bulk.amount);
  if (quantitat === null) return null;

  quantitat = quantitat.abs();
  // El banc dona l'import sempre en positiu i el sentit a part.
  if (String(raw.credit_debit_indicator ?? "").toUpperCase() !== "CRDT") {
    quantitat = quantitat.negated();
  }

  const bookingDate =
    date(raw.booking_date) ?? date(raw.value_date) ?? date(raw.transaction_date);
  if (bookingDate === null) return null;

  const creditor = partName(raw, "creditor");
  const debtor = partName(raw, "debtor");
  // La contrapart es qui rep el diner en una despesa i qui l'envia en un ingres.
  const counterparty = quantitat.isNegative() ? creditor : debtor;

  const parts = [
    remesa(raw),
    counterparty,
    String(raw.note ?? ""),
    String(asObject(raw.bank_transaction_code).description ?? ""),
  ];

  const vistos = new Set<string>();
  const descripcio: string[] = [];
  for (const part of parts) {
    const cleaned = part.split(/\s+/).filter(Boolean).join(" ");
    if (cleaned && !vistos.has(cleaned.toLowerCase())) {
      vistos.add(cleaned.toLowerCase());
      descripcio.push(cleaned);
    }
  }

  return {
    entryReference: raw.entry_reference ? String(raw.entry_reference) : null,
    transactionId: raw.transaction_id ? String(raw.transaction_id) : null,
    bookingDate,
    valueDate: date(raw.value_date),
    amount: quantitat.toFixed(2),
    currency: String(bulk.currency ?? "EUR"),
    status: state,
    description: descripcio.join(" · ").slice(0, 1000),
    counterparty: counterparty.slice(0, 200),
    bankTransactionCode: codiBank(raw).slice(0, 60),
    raw: raw,
  };
}
