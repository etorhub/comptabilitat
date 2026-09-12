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
  expected: MoneyString;
  optimista: MoneyString;
  pessimistic: MoneyString;
  /** Least-squares line over `esperat`: the overall trend. */
  trend: MoneyString;
}

export interface Forecast {
  ledgerId: number;
  ledgerName: string;
  currency: string;
  openingBalance: MoneyString;
  threshold: MoneyString;
  horizonDays: number;
  /** Always zero: kept in the type so as not to break the charts' UI. */
  dailySpend: MoneyString;
  /** Real balance rebuilt backwards (same width as the horizon). */
  history: BalancePoint[];
  points: ForecastPoint[];
  events: EventExpected[];
  firstOverdraft: string | null;
  firstOverdraftAmount: MoneyString | null;
}

/** Confirmed expected direct debits from here to the horizon. */
export async function eventsExpected(
  ledgerId: number,
  horitzo: string,
  start?: string,
): Promise<EventExpected[]> {
  const begin = start ?? todayLocal();
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
  const start = todayLocal();
  const horitzo = addDays(start, days);

  const [{ total: balance }, events, history] = await Promise.all([
    workspaceBalance(workspace.id),
    eventsExpected(workspace.id, horitzo, start),
    // Same width to the left and to the right of the chart.
    balanceSeries([workspace.id], addDays(start, -days), start),
  ]);

  const byDay = new Map<string, Decimal>();
  for (const e of events) {
    byDay.set(e.day, (byDay.get(e.day) ?? new Decimal(0)).plus(money(e.amount)));
  }

  const threshold = money(workspace.overdraftThreshold);

  const pointsWithoutTrend: Omit<ForecastPoint, "trend">[] = [];
  let running = money(balance);
  let firstOverdraft: string | null = null;
  let firstOverdraftAmount: MoneyString | null = null;

  for (let offset = 0; offset <= days; offset += 1) {
    const day = addDays(start, offset);
    running = running.plus(byDay.get(day) ?? new Decimal(0));
    const expected = running.toDecimalPlaces(2);

    // With no residual expense, the bands coincide with the expected value.
    pointsWithoutTrend.push({
      day,
      expected: toMoneyString(expected),
      optimista: toMoneyString(expected),
      pessimistic: toMoneyString(expected),
    });

    if (firstOverdraft === null && expected.lt(threshold)) {
      firstOverdraft = day;
      firstOverdraftAmount = toMoneyString(expected);
    }
  }

  const trendLine = leastSquaresLine(pointsWithoutTrend.map((p) => money(p.expected)));
  const points: ForecastPoint[] = pointsWithoutTrend.map((p, i) => ({
    ...p,
    trend: toMoneyString(trendLine[i] ?? ZERO),
  }));

  return {
    ledgerId: workspace.id,
    ledgerName: workspace.name,
    currency: workspace.currency,
    openingBalance: balance,
    threshold: workspace.overdraftThreshold,
    horizonDays: days,
    dailySpend: "0.00",
    history,
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
  const denominator = nDec.times(sumXX).minus(sumX.times(sumX));
  if (denominator.isZero()) {
    const average = sumY.dividedBy(nDec);
    return values.map(() => average.toDecimalPlaces(2));
  }

  const slope = nDec.times(sumXY).minus(sumX.times(sumY)).dividedBy(denominator);
  const origin = sumY.minus(slope.times(sumX)).dividedBy(nDec);

  return values.map((_, i) => origin.plus(slope.times(i)).toDecimalPlaces(2));
}

function isoWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-${week}`;
}

export async function checkOverdrafts(
  workspace: Ledger,
  horizonDays?: number,
): Promise<number> {
  const forecast = await buildForecast(workspace, horizonDays);
  if (forecast.firstOverdraft === null) return 0;

  const viewDays = daysBetween(todayLocal(), forecast.firstOverdraft);
  const cause = forecast.events.find(
    (e) => e.day <= (forecast.firstOverdraft as string) && money(e.amount).isNegative(),
  );

  let body =
    `Amb el saldo actual de ${money(forecast.openingBalance).toFixed(2)} EUR i els rebuts ` +
    `previstos confirmats, el saldo baixaria a ${money(forecast.firstOverdraftAmount).toFixed(2)} EUR el ` +
    `${forecast.firstOverdraft}.`;
  if (cause) body += ` El primer rebut important previst es ${cause.label}.`;

  const createdOne = await createAlert({
    type: "projected_overdraft",
    ledgerId: workspace.id,
    dedupKey: `overdraft:${workspace.id}:${isoWeek(forecast.firstOverdraft)}`,
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

  return createdOne ? 1 : 0;
}
