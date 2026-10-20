/**
 * Late salary counts in the next month's reports; the bank date stays put.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { db } from "../src/db/client.ts";
import {
  accounts,
  bankConnections,
  categories,
  ledgers,
  transactions,
  userLedgerPermissions,
  users,
} from "../src/db/schema/index.ts";
import { hashPassword } from "../src/lib/auth.ts";
import { categorizeTransaction } from "../src/services/categorization.ts";
import { incomeAndExpenses } from "../src/services/reports.ts";
import { setReportingDate } from "../src/services/reporting-date.ts";
import { SLUG_SALARY } from "../src/services/slugs.ts";
import { PASSWORD } from "./helpers.ts";

let ledgerId = 0;
let accountId = 0;
let salaryId = 0;

async function insertMovement(bookingDate: string, amount: string, categoryId: number | null) {
  const [row] = await db
    .insert(transactions)
    .values({
      accountId,
      ledgerId,
      dedupKey: `k-${Math.random()}`,
      source: "enablebanking",
      bookingDate,
      amount,
      currency: "EUR",
      status: "booked",
      description: "NOMINA",
      normalizedDescription: "nomina",
      counterparty: "",
      bankTransactionCode: "",
      merchantId: null,
      categoryId,
      categorySource: categoryId ? "user" : "none",
      needsReview: false,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    })
    .returning({ id: transactions.id });
  return row?.id ?? 0;
}

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(bankConnections);
  await db.delete(categories);
  await db.delete(userLedgerPermissions);
  await db.delete(users);
  await db.delete(ledgers);

  const [ledger] = await db
    .insert(ledgers)
    .values({
      code: "personal",
      name: "Personal",
      description: "",
      currency: "EUR",
      color: "#2563eb",
      overdraftThreshold: "0.00",
      position: 0,
      isActive: true,
      alertRecipients: [],
    })
    .returning();
  ledgerId = ledger?.id ?? 0;

  const [user] = await db
    .insert(users)
    .values({
      email: "anna@exemple.cat",
      fullName: "anna",
      passwordHash: await hashPassword(PASSWORD),
      isAdmin: false,
      isActive: true,
    })
    .returning();
  await db
    .insert(userLedgerPermissions)
    .values({ userId: user?.id ?? 0, ledgerId, role: "editor" });

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
      ledgerId,
      ebAccountUid: "uid-reporting",
      name: "Compte",
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

  const [salary] = await db
    .insert(categories)
    .values({
      ledgerId,
      slug: SLUG_SALARY,
      name: "Nomina",
      kind: "income",
      color: "#16a34a",
      icon: "",
      isSystem: true,
      position: 0,
    })
    .returning({ id: categories.id });
  salaryId = salary?.id ?? 0;
});

describe("reporting date", () => {
  test("categorising late salary moves it into the next month's income", async () => {
    const id = await insertMovement("2026-01-28", "2000.00", null);
    await categorizeTransaction(id, { merchantId: null }, salaryId);

    const [stored] = await db
      .select({
        bookingDate: transactions.bookingDate,
        reportingDate: transactions.reportingDate,
        manual: transactions.reportingDateManual,
      })
      .from(transactions);

    expect(stored?.bookingDate).toBe("2026-01-28");
    expect(stored?.reportingDate).toBe("2026-02-01");
    expect(stored?.manual).toBe(false);

    const january = await incomeAndExpenses([ledgerId], "2026-01-01", "2026-01-31");
    const february = await incomeAndExpenses([ledgerId], "2026-02-01", "2026-02-28");
    expect(january.income).toBe("0.00");
    expect(february.income).toBe("2000.00");
  });

  test("a manual date is not overwritten by the salary rule", async () => {
    const id = await insertMovement("2026-01-28", "2000.00", null);
    await setReportingDate(id, "2026-01-28", "2026-01-28");
    await categorizeTransaction(id, { merchantId: null }, salaryId);

    const [row] = await db
      .select({
        reportingDate: transactions.reportingDate,
        manual: transactions.reportingDateManual,
      })
      .from(transactions);

    expect(row?.manual).toBe(true);
    expect(row?.reportingDate).toBeNull();

    const january = await incomeAndExpenses([ledgerId], "2026-01-01", "2026-01-31");
    expect(january.income).toBe("2000.00");
  });
});
