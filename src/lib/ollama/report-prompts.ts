/**
 * Instructions for the local model that writes the reports.
 *
 * The model is handed figures that are **already computed and formatted** by
 * `services/report-facts.ts` and asked to put them into a few sentences. It
 * never sees a transaction, never adds anything up, and is told not to write a
 * number that is not in the list. The page draws the same figures next to the
 * text, so a sentence the model got wrong is easy to catch.
 *
 * **The prompt stays in Catalan**: it is input to the model and the text it
 * writes reaches a screen. The JSON keys are Catalan too, because the stored
 * `text` column is drawn as it is.
 */

import type {
  DailyFacts,
  MonthlyFacts,
  Totals,
  Unexpected,
} from "../../services/report-facts.ts";
import { formatMoney } from "../money.ts";
import { formatDate } from "../time.ts";

/** Bump this when the text changes: it is stored with every report. */
export const REPORT_PROMPT_VERSION = "1";

/** The shape Ollama enforces on the answer. */
export const REPORT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    resum: { type: "string" },
    punts: { type: "array", items: { type: "string" } },
  },
  required: ["resum", "punts"],
} as const;

export const REPORT_SYSTEM_PROMPT = `Ets l'assistent de comptabilitat domèstica d'una família. Escrius en català, amb un to proper, clar i breu.

Normes estrictes:
- Fes servir NOMÉS les xifres que et donen. No en calculis de noves, no arrodoneixis i no n'inventis cap.
- Copia els imports exactament com apareixen (per exemple «1.234,56 €»).
- Si una llista diu «cap», no en parlis o digues que no n'hi ha hagut.
- No donis consells financers genèrics ni moralitzis.
- Respon només amb un objecte JSON: {"resum": "...", "punts": ["...", "..."]}.
- «resum»: dues o tres frases. «punts»: entre dos i sis punts curts, un per idea.`;

// --- Formatting the facts --------------------------------------------------------

function totalsLines(label: string, t: Totals): string[] {
  return [
    `${label}:`,
    `  Ingressos: ${formatMoney(t.income)}`,
    `  Despeses: ${formatMoney(t.expenses)}`,
    `  Resultat (ingressos menys despeses): ${formatMoney(t.result)}`,
  ];
}

function list<T>(title: string, items: readonly T[], line: (item: T) => string): string[] {
  if (items.length === 0) return [`${title}: cap`];
  return [`${title}:`, ...items.map((item) => `  - ${line(item)}`)];
}

function unexpectedLines(u: Unexpected): string[] {
  return [
    ...list(
      "Despeses grans que no són cap rebut recurrent",
      u.outsideRecurring,
      (e) =>
        `${formatDate(e.date)}: ${e.label}${e.category ? ` (${e.category})` : ""}, ${formatMoney(e.amount)}`,
    ),
    ...list(
      "Categories molt per sobre del que és habitual",
      u.categorySpikes,
      (s) => `${s.category}: ${formatMoney(s.amount)} (un mes normal: ${formatMoney(s.usual)})`,
    ),
    ...list(
      "Rebuts recurrents més cars del previst",
      u.dearerBills,
      (b) =>
        `${formatDate(b.date)}: ${b.label}, ${formatMoney(b.amount)} (s'esperava ${formatMoney(b.expected)})`,
    ),
    ...list(
      "Comerços nous on s'ha pagat per primera vegada",
      u.newMerchants,
      (m) => `${formatDate(m.date)}: ${m.label}, ${formatMoney(m.amount)}`,
    ),
  ];
}

/** The monthly report: how the month went. */
export function buildMonthlyPrompt(workspace: string, facts: MonthlyFacts): string {
  return [
    `Escriu l'informe de tancament del mes ${facts.month} de l'espai «${workspace}».`,
    "Explica com ha anat el mes, el balanç, com es compara amb el mes anterior i quines despeses han estat inesperades.",
    "",
    "Xifres:",
    ...totalsLines(`Mes ${facts.month}`, facts.totals),
    `  De les despeses, rebuts recurrents: ${formatMoney(facts.fixedExpenses)}; la resta: ${formatMoney(facts.variableExpenses)}`,
    ...totalsLines("Mes anterior", facts.previous),
    ...list(
      "Categories on s'ha gastat més",
      facts.topCategories,
      (c) => `${c.category}: ${formatMoney(c.amount)} (${c.percent}% de les despeses)`,
    ),
    ...unexpectedLines(facts.unexpected),
    "",
    "Respon amb el JSON.",
  ].join("\n");
}

/** The morning brief: how the month is going and what is still to come. */
export function buildDailyPrompt(workspace: string, facts: DailyFacts): string {
  return [
    `Escriu el resum d'avui (${formatDate(facts.day)}) de com va el mes a l'espai «${workspace}».`,
    "Explica com va el mes fins ara comparat amb el mes passat, quins rebuts falten fins a final de mes, amb quin saldo s'acabarà previsiblement i si hi ha hagut alguna despesa inesperada.",
    "",
    "Xifres:",
    ...totalsLines("Aquest mes fins avui", facts.totals),
    ...totalsLines("El mes passat fins al mateix dia", facts.lastMonthToDate),
    facts.balance === null
      ? "Saldo actual: desconegut"
      : `Saldo actual dels comptes: ${formatMoney(facts.balance)}`,
    ...list(
      "Moviments previstos fins a final de mes (negatiu = rebut, positiu = ingrés)",
      facts.expected,
      (e) => `${formatDate(e.date)}: ${e.label}, ${formatMoney(e.amount)}`,
    ),
    `Total previst fins a final de mes: ${formatMoney(facts.expectedTotal)}`,
    facts.projectedBalance === null
      ? "Saldo previst a final de mes: desconegut"
      : `Saldo previst a final de mes: ${formatMoney(facts.projectedBalance)}`,
    ...unexpectedLines(facts.unexpected),
    "",
    "Respon amb el JSON.",
  ].join("\n");
}
