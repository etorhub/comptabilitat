/**
 * Instruccions per al model local.
 *
 * Es classifica **per comerç**, no per moviment: en regim normal apareixen
 * molt pocs comerços nous cada dia, i aixi un NAS sense targeta grafica en te
 * prou.
 *
 * Traduccio de `backend/app/integrations/ollama/prompts.py`.
 */

/** Cal pujar-la quan canviï el text: queda desada a cada suggeriment. */
export const PROMPT_VERSION = "1";

export const SYSTEM_PROMPT =
  "Ets un assistent de comptabilitat domestica. Classifiques comercos i " +
  "emissors de rebuts espanyols en una categoria d'una llista tancada. " +
  "Respons nomes amb JSON valid, sense cap text addicional. " +
  "Si no estas segur, tria la categoria mes generica i baixa la confianca.";

/** Esquema que Ollama fa complir a la resposta. */
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

/** El que sap el sistema d'un comerç abans de preguntar al model. */
export interface ContextComerc {
  normalizedName: string;
  sampleDescriptions: string[];
  typicalAmount: string;
  /** «despesa» o «ingres». */
  direction: string;
  occurrences: number;
}

/** Una categoria fulla tal com la veu el model: el slug i el nom complet. */
export interface CategoriaCatalog {
  slug: string;
  name: string;
}

/** Munta la pregunta amb la llista de categories permeses. */
export function construeixPrompt(
  context: ContextComerc,
  categories: readonly CategoriaCatalog[],
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
