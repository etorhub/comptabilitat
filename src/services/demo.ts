/**
 * Sample data.
 *
 * Eighteen months of transactions looking just like Santander's, so that it
 * can be tried without bank credentials. It is deterministic: the same seed
 * always gives the same result.
 *
 * A translation of `backend/app/services/demo.py`. The data tables were
 * generated from that file.
 *
 * **It does nothing if there are already accounts**: real data cannot be
 * loaded over by mistake.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import {
  accounts,
  balances,
  bankConnections,
  categories,
  ledgers,
  merchants,
  recurringSeries,
  transactions,
  userLedgerPermissions,
  users,
  type LedgerRole,
} from "../db/schema/index.ts";
import { hashPassword } from "../lib/auth.ts";
import { Decimal, toMoneyString } from "../lib/money.ts";
import { addDays, todayLocal } from "../lib/time.ts";
import { classifyPending } from "./classification.ts";
import { resolveCounterparty } from "./contraparts.ts";
import { checkOverdrafts } from "./forecast.ts";
import { rememberMerchantChoice } from "./merchants.ts";
import { normalizeDescription } from "./normalization.ts";
import { confirmSeries, detectRecurring } from "./recurring.ts";
import { seedLedgers } from "./seed.ts";
import { detectTransfers } from "./transfers.ts";

/** [concept, minimum amount, maximum amount, category slug] */
const Expenses: readonly (readonly [string, number, number, string])[] = [
  [
    "COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA",
    -90,
    -25,
    "alimentacio-supermercat",
  ],
  [
    "COMPRA TARJ. 5402XXXXXXXX1234 EN CARREFOUR EXPRESS, BARCELONA",
    -45,
    -12,
    "alimentacio-supermercat",
  ],
  ["PAGO MOVIL EN BAR EL RACO", -18, -6, "restauracio-bars-i-cafeteries"],
  ["COMPRA TARJ. 5402XXXXXXXX1234 EN REPSOL, GIRONA", -70, -40, "transport-combustible"],
  ["COMPRA TARJ. 5402XXXXXXXX1234 EN AMAZON EU SARL, MADRID", -60, -10, "compres-electronica"],
  ["PAGO MOVIL EN FARMACIA CENTRAL", -25, -8, "salut-farmacia"],
  [
    "COMPRA TARJ. 5402XXXXXXXX1234 EN DECATHLON, BARCELONA",
    -80,
    -15,
    "oci-i-cultura-esport-i-gimnas",
  ],
];

/** [concept, amount, every how many days, workspace, category slug] */
const Recurring: readonly (readonly [string, string, number, string, string])[] = [
  [
    "ADEUDO POR DOMICILIACION DE ENDESA ENERGIA XXI SLU",
    "-72.40",
    30,
    "personal",
    "subministraments-electricitat",
  ],
  [
    "RECIBO NETFLIX INTERNATIONAL B.V.",
    "-12.99",
    30,
    "personal",
    "oci-i-cultura-subscripcions",
  ],
  ["RECIBO SPOTIFY AB", "-11.99", 30, "personal", "oci-i-cultura-subscripcions"],
  [
    "ADEUDO POR DOMICILIACION DE AGBAR AIGUES",
    "-38.10",
    61,
    "calella",
    "subministraments-aigua",
  ],
  [
    "ADEUDO POR DOMICILIACION DE COMUNITAT DE PROPIETARIS",
    "-45.00",
    30,
    "calella",
    "habitatge-comunitat",
  ],
  [
    "ADEUDO POR DOMICILIACION DE SEGURCAIXA ADESLAS",
    "-58.20",
    30,
    "pardals",
    "salut-asseguranca-medica",
  ],
];

/**
 * [concept, amount, every how many days or `null` if one-off, workspace,
 * category slug]
 *
 * Transfers to a person, not to a merchant: this is the case that shows why
 * recurrence cannot hang off whoever receives the money. Maria pays the rent
 * every month (recurring, housing category) and we also paid her for a dinner
 * one Saturday (one-off, restaurant category): same actor, each in its own
 * category, and only the first one generates a series.
 */
const TRANSFERENCIES_PERSONALS: readonly (readonly [
  string,
  string,
  number | null,
  string,
  string,
])[] = [
  [
    "TRANSFERENCIA A MARIA GARCIA LOPEZ, LLOGUER",
    "-350.00",
    30,
    "personal",
    "habitatge-lloguer-o-hipoteca",
  ],
  [
    "TRANSFERENCIA A MARIA GARCIA LOPEZ, SOPAR DISSABTE",
    "-42.50",
    null,
    "personal",
    "restauracio-restaurants",
  ],
];

const NOMINA = "NOMINA MES EMPRESA EXEMPLE SL";
const Balances: Record<string, string> = {
  personal: "2840.15",
  calella: "610.40",
  pardals: "1275.00",
};
const Months = 18;

const Users: readonly (readonly [string, string, boolean, Record<string, LedgerRole>])[] = [
  ["demo@exemple.cat", "Tu", true, { personal: "admin", calella: "admin", pardals: "admin" }],
  ["parella@exemple.cat", "La parella", false, { pardals: "editor" }],
  ["sogra@exemple.cat", "La sogra", false, { calella: "viewer" }],
];

/**
 * Deterministic generator.
 *
 * The Python did `random.seed(20260825)`. Here a generator of our own is used
 * because JavaScript's does not accept a seed: what matters is that repeating
 * it gives the same thing, not that it gives the same thing as the Python.
 */
function generador(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export interface DemoSummary {
  state: string;
  user?: string;
  contrasenya?: string;
  transactionList?: number;
  accountList?: number;
  transfers?: number;
}

export async function fillForTests(
  email = "demo@exemple.cat",
  contrasenya = "comptabilitat",
): Promise<DemoSummary> {
  const [japle] = await db.select({ id: accounts.id }).from(accounts).limit(1);
  if (japle) return { state: "ja hi havia dades; no s'ha tocat res" };

  const atzar = generador(20260825);
  const today = todayLocal();

  await seedLedgers();
  const workspaces = await db.select().from(ledgers);
  const byCode = new Map(workspaces.map((e) => [e.code, e]));

  // --- Users ---
  for (const [correu, name, esAdmin, accessos] of Users) {
    const adreça = correu === "demo@exemple.cat" ? email : correu;
    const [ja] = await db.select().from(users).where(eq(users.email, adreça)).limit(1);
    if (ja) continue;

    const [persona] = await db
      .insert(users)
      .values({
        email: adreça,
        fullName: name,
        passwordHash: await hashPassword(contrasenya),
        isAdmin: esAdmin,
        isActive: true,
      })
      .returning();
    if (!persona) continue;

    for (const [code, rol] of Object.entries(accessos)) {
      const workspace = byCode.get(code);
      if (workspace) {
        await db
          .insert(userLedgerPermissions)
          .values({ userId: persona.id, ledgerId: workspace.id, role: rol });
      }
    }
  }

  // --- Connection and accounts ---
  const [connection] = await db
    .insert(bankConnections)
    .values({
      name: "Santander (exemple)",
      aspspName: "Santander",
      aspspCountry: "ES",
      psuType: "personal",
      ebSessionId: null,
      ebAuthState: null,
      status: "active",
      validUntil: new Date(Date.now() + 80 * 86_400_000),
      lastSyncAt: new Date(),
      lastError: "",
      createdById: null,
    })
    .returning();

  const accountList = new Map<string, { id: number; ledgerId: number }>();
  for (const [i, workspace] of workspaces.entries()) {
    const [account] = await db
      .insert(accounts)
      .values({
        connectionId: connection?.id ?? 0,
        ledgerId: workspace.id,
        ebAccountUid: `demo-uid-${workspace.code}`,
        name: `Compte ${workspace.name}`,
        product: "Compte corrent",
        iban: `ES91210004184502000513${String(30 + i).padStart(2, "0")}`,
        currency: "EUR",
        cashAccountType: "CACC",
        usage: "PRIV",
        isActive: true,
        historyStartDate: null,
        lastBookedDate: null,
        raw: {},
      })
      .returning();
    if (account) accountList.set(workspace.code, { id: account.id, ledgerId: workspace.id });
  }

  // --- Transactions ---
  let total = 0;

  const add = async (
    account: { id: number; ledgerId: number },
    day: string,
    quantitat: Decimal,
    description: string,
  ) => {
    const counterparty = await resolveCounterparty(account.ledgerId, {
      description: description,
      counterparty: "",
      bookingDate: day,
    });

    await db.insert(transactions).values({
      accountId: account.id,
      ledgerId: account.ledgerId,
      entryReference: null,
      transactionId: null,
      dedupKey:
        `demo-${account.id}-${day}-${toMoneyString(quantitat)}-${description.slice(0, 14)}`.slice(
          0,
          64,
        ),
      source: "enablebanking",
      bookingDate: day,
      valueDate: day,
      amount: toMoneyString(quantitat),
      currency: "EUR",
      status: "booked",
      description: description,
      normalizedDescription: counterparty.normalizedKey.slice(0, 200),
      counterparty: "",
      bankTransactionCode: "",
      merchantId: counterparty.merchantId,
      categoryId: null,
      categorySource: "none",
      categoryConfidence: null,
      needsReview: false,
      appliedRuleId: null,
      transferGroupId: null,
      notes: "",
      tags: [],
      isExcluded: false,
      raw: {},
    });
    total += 1;
  };

  const personal = accountList.get("personal");

  for (let month = Months; month >= 0; month -= 1) {
    const base = addDays(today, -month * 30);

    // The salary, every month.
    if (personal) {
      await add(personal, addDays(base, 1), new Decimal("2150.00"), NOMINA);
    }

    // Day-to-day expenses.
    for (const account of accountList.values()) {
      const quantes = 8 + Math.floor(atzar() * 10);
      for (let i = 0; i < quantes; i += 1) {
        const row = Expenses[Math.floor(atzar() * Expenses.length)];
        if (!row) continue;
        const [description, minim, maxim] = row;
        const quantitat = new Decimal(minim + atzar() * (maxim - minim)).toDecimalPlaces(2);
        await add(account, addDays(base, Math.floor(atzar() * 28)), quantitat, description);
      }
    }

    // Recurring direct debits.
    for (const [description, quantitat, days, codiEspai] of Recurring) {
      const account = accountList.get(codiEspai);
      if (!account) continue;
      if (month % Math.max(1, Math.round(days / 30)) !== 0) continue;
      await add(account, addDays(base, 3), new Decimal(quantitat), description);
    }

    // Transfers to a person with a declared periodicity (the rent). The
    // one-off ones (`dies === null`) are generated separately, once.
    for (const [description, quantitat, days, codiEspai] of TRANSFERENCIES_PERSONALS) {
      if (days === null) continue;
      const account = accountList.get(codiEspai);
      if (!account) continue;
      if (month % Math.max(1, Math.round(days / 30)) !== 0) continue;
      await add(account, addDays(base, 5), new Decimal(quantitat), description);
    }
  }

  // The one-off transfers to a person: once only, not every month.
  for (const [description, quantitat, days, codiEspai] of TRANSFERENCIES_PERSONALS) {
    if (days !== null) continue;
    const account = accountList.get(codiEspai);
    if (!account) continue;
    await add(account, addDays(today, -10), new Decimal(quantitat), description);
  }

  const calella = accountList.get("calella");

  // Money moving from one workspace to another. **They must not be paired**:
  // to whoever looks at Calella, that money really did come in, and where it
  // comes from is not their business. They are seen twice and separately, as
  // `docs/espais.md` says.
  if (personal && calella) {
    const day = addDays(today, -20);
    await add(personal, day, new Decimal("-400.00"), "TRASPASO A CALELLA");
    await add(calella, day, new Decimal("400.00"), "TRANSFERENCIA RECIBIDA DE TU");
  }

  // The two transactions above are not paired, but they do have a category:
  // they are a transfer between the owner's own accounts on either side. They
  // are classified directly, as whoever reviews the tray would do.
  const TRANSFERS_ENTRE_WORKSPACES: [string, string, string][] = [
    ["personal", "TRASPASO A CALELLA", "traspassos-traspas-entre-comptes-propis"],
    ["calella", "TRANSFERENCIA RECIBIDA DE TU", "traspassos-traspas-entre-comptes-propis"],
  ];

  // --- Balances ---
  for (const [code, account] of accountList) {
    await db.insert(balances).values({
      accountId: account.id,
      balanceType: "CLBD",
      amount: Balances[code] ?? "0.00",
      currency: "EUR",
      referenceDate: today,
      fetchedAt: new Date(),
    });
  }

  // --- Classification, as if someone had already been through it ---
  //
  // Without this, the demonstration starts with every transaction in the
  // review tray and nothing can be seen: no reports, no breakdown by
  // category. What is done here is what a person would do on the first day,
  // confirming each merchant's category.
  const perSlug = new Map<string, number>();
  for (const category of await db.select().from(categories)) {
    perSlug.set(`${category.ledgerId}:${category.slug}`, category.id);
  }

  const assignacions: [string, string][] = [
    ...Expenses.map(([description, , , slug]) => [description, slug] as [string, string]),
    ...Recurring.map(([description, , , , slug]) => [description, slug] as [string, string]),
    [NOMINA, "ingressos-del-treball-nomina"],
  ];

  for (const account of accountList.values()) {
    for (const [description, slug] of assignacions) {
      const [normalitzat] = normalizeDescription(description, "");
      if (!normalitzat) continue;

      const categoryId = perSlug.get(`${account.ledgerId}:${slug}`);
      if (categoryId === undefined) continue;

      const [merchant] = await db
        .select()
        .from(merchants)
        .where(
          and(
            eq(merchants.ledgerId, account.ledgerId),
            eq(merchants.normalizedName, normalitzat),
          ),
        )
        .limit(1);
      if (!merchant) continue;

      await rememberMerchantChoice(merchant, categoryId, true);
    }
  }

  // Transfers to a person have no merchant with a default category: as
  // whoever reviews the tray would really do, they are classified transaction
  // by transaction.
  const directClassification: [string, string, string][] = [
    ...TRANSFERS_ENTRE_WORKSPACES,
    ...TRANSFERENCIES_PERSONALS.map(
      ([description, , , codiEspai, slug]) =>
        [codiEspai, description, slug] as [string, string, string],
    ),
  ];

  for (const [codiEspai, description, slug] of directClassification) {
    const account = accountList.get(codiEspai);
    if (!account) continue;

    const categoryId = perSlug.get(`${account.ledgerId}:${slug}`);
    if (categoryId === undefined) continue;

    await db
      .update(transactions)
      .set({
        categoryId: categoryId,
        categorySource: "user",
        categoryConfidence: 1,
        needsReview: false,
      })
      .where(
        and(
          eq(transactions.ledgerId, account.ledgerId),
          eq(transactions.description, description),
        ),
      );
  }

  // --- And now, the same thing the scheduled job would do ---
  let transfers = 0;
  for (const workspace of workspaces) {
    transfers += await detectTransfers(workspace.id);
    await classifyPending(workspace.id);
    await detectRecurring(workspace.id);
    // In the demo we confirm the proposals: the forecast has to work right away.
    const proposals = await db
      .select({
        id: recurringSeries.id,
        cadence: recurringSeries.cadence,
        label: recurringSeries.label,
      })
      .from(recurringSeries)
      .where(
        and(
          eq(recurringSeries.ledgerId, workspace.id),
          eq(recurringSeries.status, "suggested"),
        ),
      );
    for (const proposal of proposals) {
      const tag = proposal.label.toLowerCase();
      const average =
        tag.includes("endesa") ||
        tag.includes("agbar") ||
        tag.includes("aigua") ||
        tag.includes("electric");
      await confirmSeries(proposal.id, {
        cadence: proposal.cadence,
        amountMode: average ? "average" : "exact",
      });
    }
    await checkOverdrafts(workspace);
  }

  return {
    state: "fet",
    user: email,
    contrasenya,
    transactionList: total,
    accountList: accountList.size,
    transfers,
  };
}
