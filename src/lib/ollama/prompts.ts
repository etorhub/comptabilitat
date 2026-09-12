/**
 * Instructions for the local model.
 *
 * Classification happens **per merchant**, not per transaction: in normal
 * operation very few new merchants appear each day, which is what makes a NAS
 * without a graphics card enough.
 *
 * **The prompt itself stays in Catalan.** It is not a comment: it is input to
 * the model, and it classifies Catalan and Spanish merchants. Translating it
 * would change what the model answers.
 *
 * Translated from `backend/app/integrations/ollama/prompts.py`.
 */

/** Bump this when the text changes: it is stored with every suggestion. */
export const PROMPT_VERSION = "1";

export const SYSTEM_PROMPT =
  "Ets un assistent de comptabilitat domestica. Classifiques comercos i " +
  "emissors de rebuts espanyols en una categoria d'una llista tancada. " +
  "Respons nomes amb JSON valid, sense cap text addicional. " +
  "Si no estas segur, tria la categoria mes generica i baixa la confianca.";

/** The schema Ollama enforces on the response. */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    category_slug: { type: "string" },
    merchant: { type: "string" },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["category_slug", "confidence"],
} as const;

/** What the system knows about a merchant before asking the model. */
export interface MerchantContext {
  normalizedName: string;
  sampleDescriptions: string[];
  typicalAmount: string;
  /** `despesa` (expense) or `ingres` (income). */
  direction: string;
  occurrences: number;
}

/** A leaf category as the model sees it: the slug and the full name. */
export interface CategoryCatalog {
  slug: string;
  name: string;
}

/** Builds the question, with the list of allowed categories. */
export function buildPrompt(
  context: MerchantContext,
  categories: readonly CategoryCatalog[],
): string {
  const catalog = categories.map((c) => `- ${c.slug}: ${c.name}`).join("\n");
  const samples = context.sampleDescriptions
    .slice(0, 3)
    .map((text) => `  · ${text}`)
    .join("\n");

  return (
    `Categories permeses (slug: nom):\n${catalog}\n\n` +
    `Comerc a classificar: ${context.normalizedName}\n` +
    `Tipus d'operacio: ${context.direction}\n` +
    `Import habitual: ${context.typicalAmount} EUR\n` +
    `Vegades que apareix: ${context.occurrences}\n` +
    `Conceptes tal com arriben del banc:\n${samples}\n\n` +
    "Respon amb aquest JSON:\n" +
    '{"category_slug": "<un slug de la llista>", ' +
    '"merchant": "<nom net del comerc>", ' +
    '"confidence": <0.0 a 1.0>, ' +
    '"rationale": "<justificacio en una frase curta>"}'
  );
}
