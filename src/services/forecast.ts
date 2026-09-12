/**
 * Projection of the balance from the confirmed expected direct debits.
 *
 * The active schedules with `include_in_forecast` are added to today's
 * balance. There is no residual «variable expense»: what is not an expected
 * direct debit is looked at in the reports, not in the forecast.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../db/client.ts";
import { recurringSeries, type Ledger } from "../db/schema/index.ts";
import { config } from "../lib/config.ts";
import { Decimal, money, toMoneyString, ZERO, type MoneyString } from "../lib/money.ts";
import { addDays, daysBetween, todayLocal } from "../lib/time.ts";
import { createAlert } from "./alerts.ts";
import { workspaceBalance, balanceSeries, type BalancePoint } from "./balances.ts";

export interface EventExpected {
  day: string;
  label: string;
  amount: MoneyString;
  seriesId: number | null;
}

export interface ForecastPoint {
  day: string;
  esperat: MoneyString;
  optimista: MoneyString;
  pessimista: MoneyString;
  /** Least-squares line over `esperat`: the overall trend. */
  tendencia: MoneyString;
}

export interface Forecast {
  ledgerId: number;
  ledgerName: string;
  currency: string;
  openingBalance: MoneyString;
  llindar: MoneyString;
  horizonDays: number;
  /** Always zero: kept in the type so as not to break the charts' UI. */
  dailySpend: MoneyString;
  /** Real balance rebuilt backwards (same width as the horizon). */
  historic: BalancePoint[];
  points: ForecastPoint[];
  events: EventExpected[];
  firstOverdraft: string | null;
  firstOverdraftAmount: MoneyString | null;
}

/** Confirmed expected direct debits from here to the horizon. */
export async function eventsExpected(
  ledgerId: number,
  horitzo: string,
  inici?: string,
): Promise<EventExpected[]> {
  const begin = inici ?? todayLocal();
  const events: EventExpected[] = [];

  const activeSeries = await db
    .select()
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.ledgerId, ledgerId),
        eq(recurringSeries.status, "active"),
        eq(recurringSeries.includeInForecast, true),
      ),
    );

  for (const series of activeSeries) {
    const interval = Math.max(series.intervalDays, 1);
    let occurrence = series.nextExpectedDate ?? addDays(series.lastSeenDate, interval);

    while (occurrence < begin) occurrence = addDays(occurrence, interval);

    while (occurrence <= horitzo) {
      events.push({
        day: occurrence,
        label: series.label,
        amount: series.expectedAmount,
        seriesId: series.id,
      });
      occurrence = addDays(occurrence, interval);
    }
  }

  events.sort((a, b) => a.day.localeCompare(b.day));
  return events;
}

export async function buildForecast(
  workspace: Ledger,
  horizonDays?: number,
): Promise<Forecast> {
  const days = horizonDays ?? config.forecastHorizonDays;
  const inici = todayLocal();
  const horitzo = addDays(inici, days);

  const [{ total: balance }, events, historic] = await Promise.all([
    workspaceBalance(workspace.id),
    eventsExpected(workspace.id, horitzo, inici),
    // Same width to the left and to the right of the chart.
    balanceSeries([workspace.id], addDays(inici, -days), inici),
  ]);

  const byDay = new Map<string, Decimal>();
  for (const e of events) {
    byDay.set(e.day, (byDay.get(e.day) ?? new Decimal(0)).plus(money(e.amount)));
  }

  const llindar = money(workspace.overdraftThreshold);

  const pointsWithoutTrend: Omit<ForecastPoint, "tendencia">[] = [];
  let corrent = money(balance);
  let firstOverdraft: string | null = null;
  let firstOverdraftAmount: MoneyString | null = null;

  for (let offset = 0; offset <= days; offset += 1) {
    const day = addDays(inici, offset);
    corrent = corrent.plus(byDay.get(day) ?? new Decimal(0));
    const esperat = corrent.toDecimalPlaces(2);

    // With no residual expense, the bands coincide with the expected value.
    pointsWithoutTrend.push({
      day,
      esperat: toMoneyString(esperat),
      optimista: toMoneyString(esperat),
      pessimista: toMoneyString(esperat),
    });

    if (firstOverdraft === null && esperat.lt(llindar)) {
      firstOverdraft = day;
      firstOverdraftAmount = toMoneyString(esperat);
    }
  }

  const tendencias = leastSquaresLine(pointsWithoutTrend.map((p) => money(p.esperat)));
  const points: ForecastPoint[] = pointsWithoutTrend.map((p, i) => ({
    ...p,
    tendencia: toMoneyString(tendencias[i] ?? ZERO),
  }));

  return {
    ledgerId: workspace.id,
    ledgerName: workspace.name,
    currency: workspace.currency,
    openingBalance: balance,
    llindar: workspace.overdraftThreshold,
    horizonDays: days,
    dailySpend: "0.00",
    historic,
    points,
    events,
    firstOverdraft,
    firstOverdraftAmount,
  };
}

export function leastSquaresLine(values: Decimal[]): Decimal[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0] ?? ZERO];

  let sumX = ZERO;
  let sumY = ZERO;
  let sumXY = ZERO;
  let sumXX = ZERO;

  for (let i = 0; i < n; i += 1) {
    const x = new Decimal(i);
    const y = values[i] ?? ZERO;
    sumX = sumX.plus(x);
    sumY = sumY.plus(y);
    sumXY = sumXY.plus(x.times(y));
    sumXX = sumXX.plus(x.times(x));
  }

  const nDec = new Decimal(n);
  const denominador = nDec.times(sumXX).minus(sumX.times(sumX));
  if (denominador.isZero()) {
    const mitjana = sumY.dividedBy(nDec);
    return values.map(() => mitjana.toDecimalPlaces(2));
  }

  const pendent = nDec.times(sumXY).minus(sumX.times(sumY)).dividedBy(denominador);
  const origin = sumY.minus(pendent.times(sumX)).dividedBy(nDec);

  return values.map((_, i) => origin.plus(pendent.times(i)).toDecimalPlaces(2));
}

function setmanaIso(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const inici = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const setmana = Math.ceil(((date.getTime() - inici.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-${setmana}`;
}

export async function checkOverdrafts(
  workspace: Ledger,
  horizonDays?: number,
): Promise<number> {
  const forecast = await buildForecast(workspace, horizonDays);
  if (forecast.firstOverdraft === null) return 0;

  const viewDays = daysBetween(todayLocal(), forecast.firstOverdraft);
  const causa = forecast.events.find(
    (e) => e.day <= (forecast.firstOverdraft as string) && money(e.amount).isNegative(),
  );

  let body =
    `Amb el saldo actual de ${money(forecast.openingBalance).toFixed(2)} EUR i els rebuts ` +
    `previstos confirmats, el saldo baixaria a ${money(forecast.firstOverdraftAmount).toFixed(2)} EUR el ` +
    `${forecast.firstOverdraft}.`;
  if (causa) body += ` El primer rebut important previst es ${causa.label}.`;

  const creat = await createAlert({
    type: "projected_overdraft",
    ledgerId: workspace.id,
    dedupKey: `overdraft:${workspace.id}:${setmanaIso(forecast.firstOverdraft)}`,
    title: `${workspace.name}: possible descobert d'aqui a ${viewDays} dies`,
    body: body,
    severity: viewDays <= 14 ? "critical" : "warning",
    payload: {
      ledger_id: workspace.id,
      breach_day: forecast.firstOverdraft,
      breach_amount: forecast.firstOverdraftAmount,
      starting_balance: forecast.openingBalance,
    },
  });

  return creat ? 1 : 0;
}
