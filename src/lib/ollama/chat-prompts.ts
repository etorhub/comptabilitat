/**
 * Instructions for the chat's local model.
 *
 * The model is asked **once** per message and answers with one JSON object from
 * a closed vocabulary: which intent, and which filters. It never sees a
 * transaction and never writes the answer: the server runs the query and fills
 * Catalan templates. See `docs/why.md`.
 *
 * **The prompt stays in Catalan**, like the classifier's: it is input to the
 * model, and the questions arrive in Catalan or Spanish. The JSON keys are
 * English, like the classifier's `category_slug`.
 */

/** Bump this when the text changes: it is stored with every answer. */
export const CHAT_PROMPT_VERSION = "1";

export const CHAT_INTENTS = [
  "total",
  "list",
  "breakdown",
  "series",
  "compare",
  "recategorize",
  "merchant_rule",
  "tag_add",
  "tag_remove",
  "note_set",
  "unknown",
] as const;

export const CHAT_PERIODS = [
  "all",
  "this_month",
  "last_month",
  "last_30_days",
  "last_3_months",
  "last_12_months",
  "this_year",
  "last_year",
  "year",
  "custom",
] as const;

/** The schema Ollama enforces on the response. Everything but `intent` is optional. */
export const CHAT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: CHAT_INTENTS },
    text: { type: "string" },
    merchant: { type: "string" },
    category: { type: "string" },
    account: { type: "string" },
    direction: { type: "string", enum: ["expense", "income", "any"] },
    period: { type: "string", enum: CHAT_PERIODS },
    year: { type: "integer" },
    date_from: { type: "string" },
    date_to: { type: "string" },
    compare_period: { type: "string", enum: CHAT_PERIODS },
    compare_year: { type: "integer" },
    amount_min: { type: "number" },
    amount_max: { type: "number" },
    group_by: { type: "string", enum: ["category", "merchant"] },
    order_by: { type: "string", enum: ["date", "amount"] },
    limit: { type: "integer" },
    target_category: { type: "string" },
    remember: { type: "boolean" },
    tag: { type: "string" },
    note: { type: "string" },
  },
  required: ["intent"],
} as const;

export const CHAT_SYSTEM_PROMPT = `Ets l'assistent d'una aplicació de comptabilitat domèstica. No respons mai la pregunta: només la tradueixes a un objecte JSON que l'aplicació executarà. Respons només amb JSON vàlid, sense cap text addicional.

Intencions:
- total: quant s'ha gastat o ingressat (una xifra).
- list: ensenyar moviments concrets.
- breakdown: repartiment o rànquing per categoria o per comerç ("en què he gastat més", "top 10 comerços"). Posa group_by.
- series: evolució mes a mes.
- compare: comparar dos períodes. Posa period i compare_period.
- recategorize: canviar la categoria dels moviments que compleixen el filtre. Posa target_category. Si diu "a partir d'ara" o "sempre", remember=true.
- merchant_rule: fixar la categoria per defecte d'un comerç, per als moviments d'ara i els futurs. Posa merchant i target_category.
- tag_add / tag_remove: afegir o treure l'etiqueta tag als moviments del filtre.
- note_set: posar la nota note als moviments del filtre.
- unknown: qualsevol altra cosa (esborrar dades, preguntes que no són sobre els moviments, salutacions).

Filtres (només els que la pregunta demana):
- text: una paraula que apareix al concepte del moviment ("glovo", "mercadona").
- merchant: el nom d'un comerç, només quan la pregunta parla clarament del comerç.
- category: el nom d'una categoria de la llista.
- account: el nom d'un compte de la llista.
- direction: expense si parla de gastar o pagar, income si parla d'ingressar o cobrar, any si no ho diu.
- period: all, this_month, last_month, last_30_days, last_3_months, last_12_months ("el darrer any", "l'últim any"), this_year ("enguany", "aquest any"), last_year ("l'any passat"), year (un any concret: posa year), custom (posa date_from i date_to com AAAA-MM-DD).
- amount_min, amount_max: imports en euros, sempre positius.

Si la pregunta continua l'anterior ("i l'any passat?", "i a Amazon?"), copia els filtres de la intenció anterior i canvia només el que demana.`;

export interface ChatTurn {
  question: string;
  /** The JSON the model gave back then, already validated. */
  intent: Record<string, unknown>;
}

export interface ChatContext {
  today: string;
  categories: string[];
  accounts: string[];
  history: ChatTurn[];
  question: string;
}

function list(items: string[]): string {
  return items.length === 0 ? "(cap)" : items.map((item) => `- ${item}`).join("\n");
}

/** Builds the question, with the workspace's vocabulary and the last few turns. */
export function buildChatPrompt(context: ChatContext): string {
  const history = context.history
    .map((turn) => `Pregunta: ${turn.question}\nIntenció: ${JSON.stringify(turn.intent)}`)
    .join("\n\n");

  return (
    `Avui és ${context.today}.\n\n` +
    `Categories:\n${list(context.categories)}\n\n` +
    `Comptes:\n${list(context.accounts)}\n\n` +
    "Exemples:\n" +
    'Pregunta: quant he gastat a glovo el darrer any?\nIntenció: {"intent":"total","text":"glovo","direction":"expense","period":"last_12_months"}\n' +
    'Pregunta: mou tots els moviments que continguin glovo a Menjar a domicili\nIntenció: {"intent":"recategorize","text":"glovo","target_category":"Menjar a domicili"}\n' +
    'Pregunta: en què he gastat més aquest any?\nIntenció: {"intent":"breakdown","group_by":"category","direction":"expense","period":"this_year"}\n' +
    'Pregunta: ensenya\'m els moviments de més de 100 euros del mes passat\nIntenció: {"intent":"list","amount_min":100,"period":"last_month","order_by":"amount"}\n' +
    'Pregunta: compara el que he gastat a Supermercat enguany amb l\'any passat\nIntenció: {"intent":"compare","category":"Supermercat","direction":"expense","period":"this_year","compare_period":"last_year"}\n\n' +
    (history ? `Conversa fins ara:\n${history}\n\n` : "") +
    `Pregunta: ${context.question}\nIntenció:`
  );
}
