/**
 * Projeccio del saldo i deteccio anticipada de descoberts.
 *
 * Al saldo d'avui s'hi sumen els rebuts recurrents previstos i s'hi resta una
 * deriva de despesa variable estimada dels ultims mesos. Va en tres linies
 * —esperada, optimista i pessimista— perque la despesa variable no es
 * previsible amb una sola xifra i donar-ne una de sola seria enganyos.
 *
 * Traduccio de `backend/app/services/forecast.py`.
 */

import { and, eq, inArray } from "drizzle-orm";

import { movimentsComptables } from "./filtres.ts";
import { db } from "../db/client.ts";
import {
  recurringOccurrences,
  recurringSeries,
  transactions,
  type Ledger,
} from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { Decimal, money, toMoneyString, type MoneyString } from "../lib/money.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { creaAvis } from "./alerts.ts";
import { saldoEspai } from "./balances.ts";

/** Historic que es mira per estimar la despesa variable. */
const DISCRETIONARY_WINDOW_DAYS = 90;
/** Els imports mes grans es descarten: una compra excepcional no es tendencia. */
const OUTLIER_TRIM_RATIO = 0.05;
/** Amplada de la banda optimista i pessimista sobre la despesa variable. */
const BAND_SPREAD = new Decimal("0.30");

export interface EsdevenimentPrevist {
  dia: string;
  label: string;
  amount: MoneyString;
  seriesId: number | null;
}

export interface PuntPrevisio {
  dia: string;
  esperat: MoneyString;
  optimista: MoneyString;
  pessimista: MoneyString;
}

export interface Previsio {
  ledgerId: number;
  ledgerName: string;
  currency: string;
  saldoInicial: MoneyString;
  llindar: MoneyString;
  horitzoDies: number;
  despesaDiaria: MoneyString;
  punts: PuntPrevisio[];
  esdeveniments: EsdevenimentPrevist[];
  /** El primer dia que la linia esperada cau per sota del llindar. */
  primerDescobert: string | null;
  primerDescobertImport: MoneyString | null;
}

/**
 * Despesa diaria mitjana que no ve de cap rebut recurrent.
 *
 * Es descarten els imports mes alts perque una compra excepcional no marqui
 * la tendencia de tot el trimestre.
 */
export async function despesaDiariaVariable(ledgerId: number): Promise<MoneyString> {
  const des = addDays(todayLocal(), -DISCRETIONARY_WINDOW_DAYS);

  const recurrents = new Set(
    (
      await db
        .select({ transactionId: recurringOccurrences.transactionId })
        .from(recurringOccurrences)
        .innerJoin(recurringSeries, eq(recurringSeries.id, recurringOccurrences.seriesId))
        .where(eq(recurringSeries.ledgerId, ledgerId))
    ).map((o) => o.transactionId),
  );

  const files = await db
    .select({ id: transactions.id, amount: transactions.amount })
    .from(transactions)
    .where(movimentsComptables({ espais: ledgerId, des, nomesDespeses: true }));

  const imports = files
    .filter((f) => !recurrents.has(f.id))
    .map((f) => money(f.amount).negated());

  if (imports.length === 0) return "0.00";

  imports.sort((a, b) => a.comparedTo(b));
  const retallar = Math.floor(imports.length * OUTLIER_TRIM_RATIO);
  const conservats = retallar > 0 ? imports.slice(0, -retallar) : imports;

  const total = conservats.reduce((acc, v) => acc.plus(v), new Decimal(0));
  return toMoneyString(total.dividedBy(DISCRETIONARY_WINDOW_DAYS));
}

/** Rebuts recurrents previstos d'aqui a l'horitzo. */
export async function esdevenimentsPrevistos(
  ledgerId: number,
  horitzo: string,
  inici?: string,
): Promise<EsdevenimentPrevist[]> {
  const comenca = inici ?? todayLocal();
  const esdeveniments: EsdevenimentPrevist[] = [];

  const series = await db
    .select()
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.ledgerId, ledgerId),
        eq(recurringSeries.status, "active"),
        eq(recurringSeries.includeInForecast, true),
      ),
    );

  for (const serie of series) {
    const interval = Math.max(serie.intervalDays, 1);
    let aparicio = serie.nextExpectedDate ?? addDays(serie.lastSeenDate, interval);

    // Si la data prevista ja ha passat, s'avança fins a la primera futura.
    while (aparicio < comenca) aparicio = addDays(aparicio, interval);

    while (aparicio <= horitzo) {
      esdeveniments.push({
        dia: aparicio,
        label: serie.label,
        amount: serie.expectedAmount,
        seriesId: serie.id,
      });
      aparicio = addDays(aparicio, interval);
    }
  }

  esdeveniments.sort((a, b) => a.dia.localeCompare(b.dia));
  return esdeveniments;
}

export async function construeixPrevisio(
  espai: Ledger,
  horitzoDies?: number,
): Promise<Previsio> {
  const dies = horitzoDies ?? config.forecastHorizonDays;
  const inici = todayLocal();
  const horitzo = addDays(inici, dies);

  const { total: saldo } = await saldoEspai(espai.id);
  const diaria = await despesaDiariaVariable(espai.id);
  const esdeveniments = await esdevenimentsPrevistos(espai.id, horitzo, inici);

  const perDia = new Map<string, Decimal>();
  for (const e of esdeveniments) {
    perDia.set(e.dia, (perDia.get(e.dia) ?? new Decimal(0)).plus(money(e.amount)));
  }

  const diariaDec = money(diaria);
  const derivaOptimista = diariaDec.times(new Decimal(1).minus(BAND_SPREAD));
  const derivaPessimista = diariaDec.times(new Decimal(1).plus(BAND_SPREAD));
  const llindar = money(espai.overdraftThreshold);

  const punts: PuntPrevisio[] = [];
  let corrent = money(saldo);
  let primerDescobert: string | null = null;
  let primerDescobertImport: MoneyString | null = null;

  for (let offset = 0; offset <= dies; offset += 1) {
    const dia = addDays(inici, offset);
    corrent = corrent.plus(perDia.get(dia) ?? new Decimal(0));

    const esperat = corrent.minus(diariaDec.times(offset)).toDecimalPlaces(2);

    punts.push({
      dia,
      esperat: toMoneyString(esperat),
      optimista: toMoneyString(corrent.minus(derivaOptimista.times(offset))),
      pessimista: toMoneyString(corrent.minus(derivaPessimista.times(offset))),
    });

    if (primerDescobert === null && esperat.lt(llindar)) {
      primerDescobert = dia;
      primerDescobertImport = toMoneyString(esperat);
    }
  }

  return {
    ledgerId: espai.id,
    ledgerName: espai.name,
    currency: espai.currency,
    saldoInicial: saldo,
    llindar: espai.overdraftThreshold,
    horitzoDies: dies,
    despesaDiaria: diaria,
    punts,
    esdeveniments,
    primerDescobert,
    primerDescobertImport,
  };
}

/** Setmana ISO d'una data, per deduplicar l'avis un cop per setmana. */
function setmanaIso(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const data = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const dia = data.getUTCDay() || 7;
  data.setUTCDate(data.getUTCDate() + 4 - dia);
  const inici = new Date(Date.UTC(data.getUTCFullYear(), 0, 1));
  const setmana = Math.ceil(((data.getTime() - inici.getTime()) / 86_400_000 + 1) / 7);
  return `${data.getUTCFullYear()}-${setmana}`;
}

/**
 * Avisa si es preveu que l'espai entri en descobert.
 *
 * Un avis per espai i setmana: el mateix descobert no ha d'avisar cada dia.
 */
export async function comprovaDescoberts(espai: Ledger, horitzoDies?: number): Promise<number> {
  const previsio = await construeixPrevisio(espai, horitzoDies);
  if (previsio.primerDescobert === null) return 0;

  const diesVista = daysBetween(todayLocal(), previsio.primerDescobert);
  const causa = previsio.esdeveniments.find(
    (e) => e.dia <= (previsio.primerDescobert as string) && money(e.amount).isNegative(),
  );

  let cos =
    `Amb el saldo actual de ${money(previsio.saldoInicial).toFixed(2)} EUR, els rebuts ` +
    `previstos i una despesa variable de ${money(previsio.despesaDiaria).toFixed(2)} EUR al ` +
    `dia, el saldo baixaria a ${money(previsio.primerDescobertImport).toFixed(2)} EUR el ` +
    `${previsio.primerDescobert}.`;
  if (causa) cos += ` El primer rebut important previst es ${causa.label}.`;

  const creat = await creaAvis({
    type: "projected_overdraft",
    ledgerId: espai.id,
    dedupKey: `overdraft:${espai.id}:${setmanaIso(previsio.primerDescobert)}`,
    title: `${espai.name}: possible descobert d'aqui a ${diesVista} dies`,
    body: cos,
    // Si falta poc, es urgent; si falta mes, nomes es un avis.
    severity: diesVista <= 14 ? "critical" : "warning",
    payload: {
      ledger_id: espai.id,
      breach_day: previsio.primerDescobert,
      breach_amount: previsio.primerDescobertImport,
      starting_balance: previsio.saldoInicial,
    },
  });

  return creat ? 1 : 0;
}

export { inArray };
