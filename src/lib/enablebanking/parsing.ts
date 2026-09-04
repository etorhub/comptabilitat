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

function comObjecte(valor: unknown): Record<string, unknown> {
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
function data(valor: unknown): string | null {
  if (!valor) return null;
  const text = String(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function primeraIdentificacio(cru: Record<string, unknown>, scheme = "IBAN"): string {
  const accountId = comObjecte(cru.account_id);
  if (typeof accountId.iban === "string" && accountId.iban) return accountId.iban;

  for (const item of Array.isArray(cru.all_account_ids) ? cru.all_account_ids : []) {
    const obj = comObjecte(item);
    if (String(obj.scheme_name ?? "").toUpperCase() === scheme) {
      return String(obj.identification ?? "");
    }
  }
  return "";
}

export interface CompteAnalitzat {
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
export function parseAccount(cru: Record<string, unknown>): CompteAnalitzat {
  return {
    ebAccountUid: String(cru.uid ?? ""),
    name: String(cru.name ?? cru.details ?? ""),
    product: String(cru.product ?? ""),
    iban: primeraIdentificacio(cru),
    currency: String(cru.currency ?? "EUR"),
    cashAccountType: String(cru.cash_account_type ?? ""),
    usage: String(cru.usage ?? ""),
    raw: cru,
  };
}

export interface SaldoAnalitzat {
  balanceType: string;
  amount: string;
  currency: string;
  referenceDate: string | null;
}

export function parseBalance(cru: Record<string, unknown>): SaldoAnalitzat | null {
  const bloc = comObjecte(cru.balance_amount);
  const quantitat = decimal(bloc.amount);
  if (quantitat === null) return null;

  return {
    balanceType: String(cru.balance_type ?? cru.name ?? "OTHR"),
    amount: quantitat.toFixed(2),
    currency: String(bloc.currency ?? "EUR"),
    referenceDate: data(cru.reference_date) ?? data(cru.last_change_date_time),
  };
}

function nomDePart(cru: Record<string, unknown>, clau: string): string {
  const part = comObjecte(cru[clau]);
  return String(part.name ?? "");
}

function remesa(cru: Record<string, unknown>): string {
  const info = cru.remittance_information;
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

function codiBanc(cru: Record<string, unknown>): string {
  const bloc = comObjecte(cru.bank_transaction_code);
  const trossos = [bloc.code, bloc.sub_code].filter(Boolean).map(String);
  return trossos.length > 0 ? trossos.join("/") : String(bloc.description ?? "");
}

export interface MovimentAnalitzat {
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
export function dedupKey(moviment: MovimentAnalitzat): string {
  if (moviment.entryReference) {
    return `ref:${moviment.entryReference}`.slice(0, 64);
  }

  const parts = [
    moviment.bookingDate,
    new Decimal(moviment.amount).toFixed(2),
    moviment.currency,
    moviment.description.trim().toLowerCase(),
    moviment.counterparty.trim().toLowerCase(),
  ].join("|");

  const resum = new Bun.CryptoHasher("sha256").update(parts).digest("hex");
  return `h:${resum}`.slice(0, 64);
}

/** Converteix un moviment de l'API. Retorna `null` si no s'ha de desar. */
export function parseTransaction(cru: Record<string, unknown>): MovimentAnalitzat | null {
  const estat = STATUS_MAP[String(cru.status ?? "BOOK").toUpperCase()];
  if (estat === undefined) return null;

  const bloc = comObjecte(cru.transaction_amount);
  let quantitat = decimal(bloc.amount);
  if (quantitat === null) return null;

  quantitat = quantitat.abs();
  // El banc dona l'import sempre en positiu i el sentit a part.
  if (String(cru.credit_debit_indicator ?? "").toUpperCase() !== "CRDT") {
    quantitat = quantitat.negated();
  }

  const bookingDate =
    data(cru.booking_date) ?? data(cru.value_date) ?? data(cru.transaction_date);
  if (bookingDate === null) return null;

  const creditor = nomDePart(cru, "creditor");
  const debtor = nomDePart(cru, "debtor");
  // La contrapart es qui rep el diner en una despesa i qui l'envia en un ingres.
  const counterparty = quantitat.isNegative() ? creditor : debtor;

  const trossos = [
    remesa(cru),
    counterparty,
    String(cru.note ?? ""),
    String(comObjecte(cru.bank_transaction_code).description ?? ""),
  ];

  const vistos = new Set<string>();
  const descripcio: string[] = [];
  for (const tros of trossos) {
    const net = tros.split(/\s+/).filter(Boolean).join(" ");
    if (net && !vistos.has(net.toLowerCase())) {
      vistos.add(net.toLowerCase());
      descripcio.push(net);
    }
  }

  return {
    entryReference: cru.entry_reference ? String(cru.entry_reference) : null,
    transactionId: cru.transaction_id ? String(cru.transaction_id) : null,
    bookingDate,
    valueDate: data(cru.value_date),
    amount: quantitat.toFixed(2),
    currency: String(bloc.currency ?? "EUR"),
    status: estat,
    description: descripcio.join(" · ").slice(0, 1000),
    counterparty: counterparty.slice(0, 200),
    bankTransactionCode: codiBanc(cru).slice(0, 60),
    raw: cru,
  };
}
