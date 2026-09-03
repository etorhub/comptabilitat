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
  transactions,
  userLedgerPermissions,
  users,
  type LedgerRole,
} from "../db/schema/index.ts";
import { hashPassword } from "../lib/auth.ts";
import { Decimal, toMoneyString } from "../lib/money.ts";
import { addDays, todayLocal } from "../lib/time.ts";
import { classificaPendents } from "./classification.ts";
import { comprovaDescoberts } from "./forecast.ts";
import { obteOCreaComerc, recordaEleccioComerc } from "./merchants.ts";
import { normalizeDescription } from "./normalization.ts";
import { detectaRecurrents } from "./recurring.ts";
import { seedLedgers } from "./seed.ts";
import { detectaTraspassos } from "./transfers.ts";

/** [concepte, import minim, import maxim, pendent de la categoria] */
const DESPESES: readonly (readonly [string, number, number, string])[] = [
  ["COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA", -90, -25, "alimentacio-supermercat"],
  ["COMPRA TARJ. 5402XXXXXXXX1234 EN CARREFOUR EXPRESS, BARCELONA", -45, -12, "alimentacio-supermercat"],
  ["PAGO MOVIL EN BAR EL RACO", -18, -6, "restauracio-bars-i-cafeteries"],
  ["COMPRA TARJ. 5402XXXXXXXX1234 EN REPSOL, GIRONA", -70, -40, "transport-combustible"],
  ["COMPRA TARJ. 5402XXXXXXXX1234 EN AMAZON EU SARL, MADRID", -60, -10, "compres-electronica"],
  ["PAGO MOVIL EN FARMACIA CENTRAL", -25, -8, "salut-farmacia"],
  ["COMPRA TARJ. 5402XXXXXXXX1234 EN DECATHLON, BARCELONA", -80, -15, "oci-i-cultura-esport-i-gimnas"],
];

/** [concepte, import, cada quants dies, espai, pendent de la categoria] */
const RECURRENTS: readonly (readonly [string, string, number, string, string])[] = [
  ["ADEUDO POR DOMICILIACION DE ENDESA ENERGIA XXI SLU", "-72.40", 30, "personal", "subministraments-electricitat"],
  ["RECIBO NETFLIX INTERNATIONAL B.V.", "-12.99", 30, "personal", "oci-i-cultura-subscripcions"],
  ["RECIBO SPOTIFY AB", "-11.99", 30, "personal", "oci-i-cultura-subscripcions"],
  ["ADEUDO POR DOMICILIACION DE AGBAR AIGUES", "-38.10", 61, "calella", "subministraments-aigua"],
  ["ADEUDO POR DOMICILIACION DE COMUNITAT DE PROPIETARIS", "-45.00", 30, "calella", "habitatge-comunitat"],
  ["ADEUDO POR DOMICILIACION DE SEGURCAIXA ADESLAS", "-58.20", 30, "pardals", "salut-asseguranca-medica"],
];

const NOMINA = "NOMINA MES EMPRESA EXEMPLE SL";
const SALDOS: Record<string, string> = {"personal": "2840.15", "calella": "610.40", "pardals": "1275.00"};
const MESOS = 18;

const USUARIS: readonly (readonly [string, string, boolean, Record<string, LedgerRole>])[] = [
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
function generador(llavor: number): () => number {
  let estat = llavor >>> 0;
  return () => {
    estat = (estat * 1_664_525 + 1_013_904_223) >>> 0;
    return estat / 0x1_0000_0000;
  };
}

export interface ResumDemo {
  estat: string;
  usuari?: string;
  contrasenya?: string;
  moviments?: number;
  comptes?: number;
  traspassos?: number;
}

export async function omplePerAProves(
  email = "demo@exemple.cat",
  contrasenya = "comptabilitat",
): Promise<ResumDemo> {
  const [japle] = await db.select({ id: accounts.id }).from(accounts).limit(1);
  if (japle) return { estat: "ja hi havia dades; no s'ha tocat res" };

  const atzar = generador(20260825);
  const avui = todayLocal();

  await seedLedgers();
  const espais = await db.select().from(ledgers);
  const perCodi = new Map(espais.map((e) => [e.code, e]));

  // --- Usuaris ---
  for (const [correu, nom, esAdmin, accessos] of USUARIS) {
    const adreça = correu === "demo@exemple.cat" ? email : correu;
    const [ja] = await db.select().from(users).where(eq(users.email, adreça)).limit(1);
    if (ja) continue;

    const [persona] = await db
      .insert(users)
      .values({
        email: adreça,
        fullName: nom,
        passwordHash: await hashPassword(contrasenya),
        isAdmin: esAdmin,
        isActive: true,
      })
      .returning();
    if (!persona) continue;

    for (const [codi, rol] of Object.entries(accessos)) {
      const espai = perCodi.get(codi);
      if (espai) {
        await db
          .insert(userLedgerPermissions)
          .values({ userId: persona.id, ledgerId: espai.id, role: rol });
      }
    }
  }

  // --- Connexio i comptes ---
  const [connexio] = await db
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

  const comptes = new Map<string, { id: number; ledgerId: number }>();
  for (const [i, espai] of espais.entries()) {
    const [compte] = await db
      .insert(accounts)
      .values({
        connectionId: connexio?.id ?? 0,
        ledgerId: espai.id,
        ebAccountUid: `demo-uid-${espai.code}`,
        name: `Compte ${espai.name}`,
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
    if (compte) comptes.set(espai.code, { id: compte.id, ledgerId: espai.id });
  }

  // --- Moviments ---
  let total = 0;

  const afegeix = async (
    compte: { id: number; ledgerId: number },
    dia: string,
    quantitat: Decimal,
    concepte: string,
  ) => {
    const [normalitzat, mostrar] = normalizeDescription(concepte, "");
    const comerc = normalitzat
      ? await obteOCreaComerc(compte.ledgerId, normalitzat, mostrar, dia)
      : null;

    await db.insert(transactions).values({
      accountId: compte.id,
      ledgerId: compte.ledgerId,
      entryReference: null,
      transactionId: null,
      dedupKey: `demo-${compte.id}-${dia}-${toMoneyString(quantitat)}-${concepte.slice(0, 14)}`.slice(0, 64),
      source: "enablebanking",
      bookingDate: dia,
      valueDate: dia,
      amount: toMoneyString(quantitat),
      currency: "EUR",
      status: "booked",
      description: concepte,
      normalizedDescription: normalitzat.slice(0, 200),
      counterparty: "",
      bankTransactionCode: "",
      merchantId: comerc?.id ?? null,
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

  const personal = comptes.get("personal");

  for (let mes = MESOS; mes >= 0; mes -= 1) {
    const base = addDays(avui, -mes * 30);

    // La nomina, cada mes.
    if (personal) {
      await afegeix(personal, addDays(base, 1), new Decimal("2150.00"), NOMINA);
    }

    // Despeses del dia a dia.
    for (const compte of comptes.values()) {
      const quantes = 8 + Math.floor(atzar() * 10);
      for (let i = 0; i < quantes; i += 1) {
        const fila = DESPESES[Math.floor(atzar() * DESPESES.length)];
        if (!fila) continue;
        const [concepte, minim, maxim] = fila;
        const quantitat = new Decimal(minim + atzar() * (maxim - minim)).toDecimalPlaces(2);
        await afegeix(compte, addDays(base, Math.floor(atzar() * 28)), quantitat, concepte);
      }
    }

    // Rebuts recurrents.
    for (const [concepte, quantitat, dies, codiEspai] of RECURRENTS) {
      const compte = comptes.get(codiEspai);
      if (!compte) continue;
      if (mes % Math.max(1, Math.round(dies / 30)) !== 0) continue;
      await afegeix(compte, addDays(base, 3), new Decimal(quantitat), concepte);
    }
  }

  // Diners que passen d'un espai a un altre. **No s'han d'aparellar**: per a
  // qui mira Calella, aquests diners hi han entrat de debò, i d'on venen no es
  // cosa seva. Es veuen dues vegades i per separat, com diu `docs/espais.md`.
  const calella = comptes.get("calella");
  if (personal && calella) {
    const dia = addDays(avui, -20);
    await afegeix(personal, dia, new Decimal("-400.00"), "TRASPASO A CALELLA");
    await afegeix(calella, dia, new Decimal("400.00"), "TRANSFERENCIA RECIBIDA DE TU");
  }

  // --- Saldos ---
  for (const [codi, compte] of comptes) {
    await db.insert(balances).values({
      accountId: compte.id,
      balanceType: "CLBD",
      amount: SALDOS[codi] ?? "0.00",
      currency: "EUR",
      referenceDate: avui,
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
  for (const categoria of await db.select().from(categories)) {
    perSlug.set(`${categoria.ledgerId}:${categoria.slug}`, categoria.id);
  }

  const assignacions: [string, string][] = [
    ...DESPESES.map(([concepte, , , slug]) => [concepte, slug] as [string, string]),
    ...RECURRENTS.map(([concepte, , , , slug]) => [concepte, slug] as [string, string]),
    [NOMINA, "ingressos-del-treball-nomina"],
  ];

  for (const compte of comptes.values()) {
    for (const [concepte, slug] of assignacions) {
      const [normalitzat] = normalizeDescription(concepte, "");
      if (!normalitzat) continue;

      const categoriaId = perSlug.get(`${compte.ledgerId}:${slug}`);
      if (categoriaId === undefined) continue;

      const [comerc] = await db
        .select()
        .from(merchants)
        .where(
          and(
            eq(merchants.ledgerId, compte.ledgerId),
            eq(merchants.normalizedName, normalitzat),
          ),
        )
        .limit(1);
      if (!comerc) continue;

      await recordaEleccioComerc(comerc, categoriaId, true);
    }
  }

  // --- I ara, el mateix que faria la feina programada ---
  let traspassos = 0;
  for (const espai of espais) {
    traspassos += await detectaTraspassos(espai.id);
    await classificaPendents(espai.id);
    await detectaRecurrents(espai.id);
    await comprovaDescoberts(espai);
  }

  return {
    estat: "fet",
    usuari: email,
    contrasenya,
    moviments: total,
    comptes: comptes.size,
    traspassos,
  };
}
