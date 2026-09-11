/**
 * Projeccio del saldo a partir dels rebuts previstos confirmats.
 *
 * Al saldo d'avui s'hi sumen els schedules actius amb `include_in_forecast`.
 * No hi ha «despesa variable» residual: el que no es un rebut previst es mira
 * als informes, no a la previsio.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import { recurringSeries, type Ledger } from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { Decimal, money, toMoneyString, ZERO, type MoneyString } from "../lib/money.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { creaAvis } from "./alerts.ts";
import { saldoEspai, serieSaldos, type PuntSaldo } from "./balances.ts";

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
  /** Recta de minims quadrats sobre `esperat`: la tendencia de conjunt. */
  tendencia: MoneyString;
}

export interface Previsio {
  ledgerId: number;
  ledgerName: string;
  currency: string;
  saldoInicial: MoneyString;
  llindar: MoneyString;
  horitzoDies: number;
  /** Sempre zero: es conserva al tipus per no trencar la UI dels grafics. */
  despesaDiaria: MoneyString;
  /** Saldo real reconstruit cap enrere (mateixa amplada que l'horitzo). */
  historic: PuntSaldo[];
  punts: PuntPrevisio[];
  esdeveniments: EsdevenimentPrevist[];
  primerDescobert: string | null;
  primerDescobertImport: MoneyString | null;
}

/** Rebuts previstos confirmats d'aqui a l'horitzo. */
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

  const [{ total: saldo }, esdeveniments, historic] = await Promise.all([
    saldoEspai(espai.id),
    esdevenimentsPrevistos(espai.id, horitzo, inici),
    // Mateixa amplada a esquerra i dreta del grafic.
    serieSaldos([espai.id], addDays(inici, -dies), inici),
  ]);

  const perDia = new Map<string, Decimal>();
  for (const e of esdeveniments) {
    perDia.set(e.dia, (perDia.get(e.dia) ?? new Decimal(0)).plus(money(e.amount)));
  }

  const llindar = money(espai.overdraftThreshold);

  const puntsSenseTendencia: Omit<PuntPrevisio, "tendencia">[] = [];
  let corrent = money(saldo);
  let primerDescobert: string | null = null;
  let primerDescobertImport: MoneyString | null = null;

  for (let offset = 0; offset <= dies; offset += 1) {
    const dia = addDays(inici, offset);
    corrent = corrent.plus(perDia.get(dia) ?? new Decimal(0));
    const esperat = corrent.toDecimalPlaces(2);

    // Sense despesa residual, les bandes coincideixen amb l'esperat.
    puntsSenseTendencia.push({
      dia,
      esperat: toMoneyString(esperat),
      optimista: toMoneyString(esperat),
      pessimista: toMoneyString(esperat),
    });

    if (primerDescobert === null && esperat.lt(llindar)) {
      primerDescobert = dia;
      primerDescobertImport = toMoneyString(esperat);
    }
  }

  const tendencias = rectaMinimsQuadrats(puntsSenseTendencia.map((p) => money(p.esperat)));
  const punts: PuntPrevisio[] = puntsSenseTendencia.map((p, i) => ({
    ...p,
    tendencia: toMoneyString(tendencias[i] ?? ZERO),
  }));

  return {
    ledgerId: espai.id,
    ledgerName: espai.name,
    currency: espai.currency,
    saldoInicial: saldo,
    llindar: espai.overdraftThreshold,
    horitzoDies: dies,
    despesaDiaria: "0.00",
    historic,
    punts,
    esdeveniments,
    primerDescobert,
    primerDescobertImport,
  };
}

export function rectaMinimsQuadrats(valors: Decimal[]): Decimal[] {
  const n = valors.length;
  if (n === 0) return [];
  if (n === 1) return [valors[0] ?? ZERO];

  let sumX = ZERO;
  let sumY = ZERO;
  let sumXY = ZERO;
  let sumXX = ZERO;

  for (let i = 0; i < n; i += 1) {
    const x = new Decimal(i);
    const y = valors[i] ?? ZERO;
    sumX = sumX.plus(x);
    sumY = sumY.plus(y);
    sumXY = sumXY.plus(x.times(y));
    sumXX = sumXX.plus(x.times(x));
  }

  const nDec = new Decimal(n);
  const denominador = nDec.times(sumXX).minus(sumX.times(sumX));
  if (denominador.isZero()) {
    const mitjana = sumY.dividedBy(nDec);
    return valors.map(() => mitjana.toDecimalPlaces(2));
  }

  const pendent = nDec.times(sumXY).minus(sumX.times(sumY)).dividedBy(denominador);
  const origen = sumY.minus(pendent.times(sumX)).dividedBy(nDec);

  return valors.map((_, i) => origen.plus(pendent.times(i)).toDecimalPlaces(2));
}

function setmanaIso(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const data = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const dia = data.getUTCDay() || 7;
  data.setUTCDate(data.getUTCDate() + 4 - dia);
  const inici = new Date(Date.UTC(data.getUTCFullYear(), 0, 1));
  const setmana = Math.ceil(((data.getTime() - inici.getTime()) / 86_400_000 + 1) / 7);
  return `${data.getUTCFullYear()}-${setmana}`;
}

export async function comprovaDescoberts(espai: Ledger, horitzoDies?: number): Promise<number> {
  const previsio = await construeixPrevisio(espai, horitzoDies);
  if (previsio.primerDescobert === null) return 0;

  const diesVista = daysBetween(todayLocal(), previsio.primerDescobert);
  const causa = previsio.esdeveniments.find(
    (e) => e.dia <= (previsio.primerDescobert as string) && money(e.amount).isNegative(),
  );

  let cos =
    `Amb el saldo actual de ${money(previsio.saldoInicial).toFixed(2)} EUR i els rebuts ` +
    `previstos confirmats, el saldo baixaria a ${money(previsio.primerDescobertImport).toFixed(2)} EUR el ` +
    `${previsio.primerDescobert}.`;
  if (causa) cos += ` El primer rebut important previst es ${causa.label}.`;

  const creat = await creaAvis({
    type: "projected_overdraft",
    ledgerId: espai.id,
    dedupKey: `overdraft:${espai.id}:${setmanaIso(previsio.primerDescobert)}`,
    title: `${espai.name}: possible descobert d'aqui a ${diesVista} dies`,
    body: cos,
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
