/**
 * Dades d'exemple.
 *
 * Divuit mesos de moviments amb la mateixa pinta que els del Santander, per
 * poder-ho provar sense credencials del banc. Es determinista: el mateix
 * llavor dona sempre el mateix resultat.
 *
 * Traduccio de `backend/app/services/demo.py`. Les taules de dades s'han
 * generat a partir d'aquell fitxer.
 *
 * **No fa res si ja hi ha comptes**: no es pot carregar dades de debò per
 * error.
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

/** [concepte, import minim, import maxim, pendent de la categoria] */
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

/** [concepte, import, cada quants dies, espai, pendent de la categoria] */
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
 * [concepte, import, cada quants dies o `null` si es excepcional, espai,
 * pendent de la categoria]
 *
 * Transferencies a una persona, no a un comerç: es el cas que demostra per
 * que la recurrencia no pot penjar de qui rep els diners. La Maria fa el
 * lloguer cada mes (recurrent, categoria d'habitatge) i tambe li vam pagar un
 * sopar un dissabte (excepcional, categoria de restauracio): mateix actor,
 * cadascuna a la seva categoria, i nomes la primera genera una serie.
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
 * Generador determinista.
 *
 * El Python feia `random.seed(20260825)`. Aqui es fa servir un generador
 * propi perque el de JavaScript no accepta llavor: el que importa es que
 * repetir-ho doni el mateix, no que doni el mateix que el Python.
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

  // --- Usuaris ---
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

  // --- Connexio i comptes ---
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

  // --- Moviments ---
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

    // La nomina, cada mes.
    if (personal) {
      await add(personal, addDays(base, 1), new Decimal("2150.00"), NOMINA);
    }

    // Despeses del dia a dia.
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

    // Rebuts recurrents.
    for (const [description, quantitat, days, codiEspai] of Recurring) {
      const account = accountList.get(codiEspai);
      if (!account) continue;
      if (month % Math.max(1, Math.round(days / 30)) !== 0) continue;
      await add(account, addDays(base, 3), new Decimal(quantitat), description);
    }

    // Transferencies a una persona amb periodicitat declarada (el lloguer).
    // Les excepcionals (`dies === null`) es generen a banda, un cop.
    for (const [description, quantitat, days, codiEspai] of TRANSFERENCIES_PERSONALS) {
      if (days === null) continue;
      const account = accountList.get(codiEspai);
      if (!account) continue;
      if (month % Math.max(1, Math.round(days / 30)) !== 0) continue;
      await add(account, addDays(base, 5), new Decimal(quantitat), description);
    }
  }

  // Les transferencies excepcionals a una persona: un sol cop, no cada mes.
  for (const [description, quantitat, days, codiEspai] of TRANSFERENCIES_PERSONALS) {
    if (days !== null) continue;
    const account = accountList.get(codiEspai);
    if (!account) continue;
    await add(account, addDays(today, -10), new Decimal(quantitat), description);
  }

  // Diners que passen d'un espai a un altre. **No s'han d'aparellar**: per a
  // qui mira Calella, aquests diners hi han entrat de debò, i d'on venen no es
  // cosa seva. Es veuen dues vegades i per separat, com diu `docs/espais.md`.
  const calella = accountList.get("calella");
  if (personal && calella) {
    const day = addDays(today, -20);
    await add(personal, day, new Decimal("-400.00"), "TRASPASO A CALELLA");
    await add(calella, day, new Decimal("400.00"), "TRANSFERENCIA RECIBIDA DE TU");
  }

  // Els dos moviments d'abans no s'aparellen, pero si que tenen categoria:
  // son un traspas entre comptes propis a banda i banda. Es classifiquen
  // directament, com faria qui revisa la safata.
  const TRANSFERS_ENTRE_WORKSPACES: [string, string, string][] = [
    ["personal", "TRASPASO A CALELLA", "traspassos-traspas-entre-comptes-propis"],
    ["calella", "TRANSFERENCIA RECIBIDA DE TU", "traspassos-traspas-entre-comptes-propis"],
  ];

  // --- Saldos ---
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

  // --- Classificacio, com si algu ja hi hagues passat ---
  //
  // Sense aixo, la demostracio arrenca amb tots els moviments a la safata de
  // revisio i no s'hi veu res: ni informes, ni repartiment per categoria. El
  // que es fa aqui es el que faria una persona el primer dia, confirmant la
  // categoria de cada comerç.
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

  // Les transferencies a una persona no tenen comerç amb categoria per
  // defecte: com faria de debò qui revisa la safata, es classifiquen
  // moviment a moviment.
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

  // --- I ara, el mateix que faria la feina programada ---
  let transfers = 0;
  for (const workspace of workspaces) {
    transfers += await detectTransfers(workspace.id);
    await classifyPending(workspace.id);
    await detectRecurring(workspace.id);
    // A la demo confirmem les propostes: la previsio ha de funcionar de seguida.
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
