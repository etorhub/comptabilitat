/**
 * Client d'Ollama per a la classificacio amb un model local.
 *
 * Traduccio de `backend/app/integrations/ollama/client.py`.
 */

import { z } from "zod/v4";

import { config } from "../config.ts";
import {
  construeixPrompt,
  PROMPT_VERSION,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  type CategoriaCatalog,
  type ContextComerc,
} from "./prompts.ts";

/** El model local no ha respost o ha respost malament. */
export class OllamaError extends Error {
  constructor(missatge: string) {
    super(missatge);
    this.name = "OllamaError";
  }
}

export interface Suggeriment {
  categorySlug: string;
  confidence: number;
  merchant: string;
  rationale: string;
  model: string;
  promptVersion: string;
}

/** Les etiquetes que te descarregades el servidor. */
const respostaTags = z.object({
  models: z.array(z.object({ name: z.string().optional() })).default([]),
});

const respostaChat = z.object({
  message: z.object({ content: z.string().optional() }).optional(),
});

/**
 * El contingut que retorna el model. Es JSON dins d'una cadena, i el model
 * s'equivoca: `confidence` pot arribar com a text i `rationale` pot no ser-hi.
 * Per aixo tot es opcional aqui i es sanejat a `classify()`.
 */
const contingut = z.object({
  category_slug: z.string().optional(),
  merchant: z.string().optional(),
  confidence: z.union([z.number(), z.string()]).optional(),
  rationale: z.string().optional(),
});

export interface OpcionsOllama {
  baseUrl?: string;
  model?: string;
  timeoutSeconds?: number;
}

export class OllamaClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutSeconds: number;

  constructor(opcions: OpcionsOllama = {}) {
    this.baseUrl = (opcions.baseUrl ?? config.ollamaBaseUrl).replace(/\/$/, "");
    this.model = opcions.model ?? config.ollamaModel;
    this.timeoutSeconds = opcions.timeoutSeconds ?? config.ollamaTimeoutSeconds;
  }

  /** Comprova que el servei respon i que el model hi es. */
  async isAvailable(): Promise<boolean> {
    let dades: unknown;
    try {
      const resposta = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      dades = await resposta.json();
    } catch (error) {
      console.warn(`[ollama] no respon a ${this.baseUrl}: ${missatge(error)}`);
      return false;
    }

    const noms = respostaTags
      .parse(dades)
      .models.map((m) => m.name ?? "")
      .filter((n) => n !== "");

    // Les etiquetes poden portar sufix (:latest), aixi que es compara el prefix.
    const base = this.model.split(":")[0];
    const hiEs = noms.some((nom) => nom.split(":")[0] === base);
    if (!hiEs) {
      console.warn(
        `[ollama] el model ${this.model} no esta descarregat (n'hi ha ${noms.sort().join(", ")})`,
      );
    }
    return hiEs;
  }

  /** Demana la categoria d'un comerç. Llança `OllamaError` si falla. */
  async classify(
    context: ContextComerc,
    categories: readonly CategoriaCatalog[],
  ): Promise<Suggeriment> {
    const cos = {
      model: this.model,
      stream: false,
      format: RESPONSE_SCHEMA,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: construeixPrompt(context, categories) },
      ],
      options: {
        // Determinista: la mateixa entrada ha de donar la mateixa sortida.
        temperature: 0,
        num_predict: 200,
      },
    };

    let dades: unknown;
    try {
      const resposta = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cos),
        signal: AbortSignal.timeout(this.timeoutSeconds * 1000),
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      dades = await resposta.json();
    } catch (error) {
      throw new OllamaError(`Ollama no ha respost: ${missatge(error)}`);
    }

    const text = respostaChat.parse(dades).message?.content ?? "";
    let cru: unknown;
    try {
      cru = JSON.parse(text);
    } catch {
      throw new OllamaError(`Resposta no interpretable: ${text.slice(0, 200)}`);
    }

    const analitzat = contingut.safeParse(cru);
    if (!analitzat.success) {
      throw new OllamaError(`Resposta no interpretable: ${text.slice(0, 200)}`);
    }

    const slug = (analitzat.data.category_slug ?? "").trim();
    if (slug === "") {
      throw new OllamaError("La resposta no porta cap categoria");
    }

    const confianca = Number(analitzat.data.confidence ?? 0);

    return {
      categorySlug: slug,
      confidence: Number.isFinite(confianca) ? Math.max(0, Math.min(1, confianca)) : 0,
      merchant: (analitzat.data.merchant ?? "").slice(0, 200),
      rationale: (analitzat.data.rationale ?? "").slice(0, 500),
      model: this.model,
      promptVersion: PROMPT_VERSION,
    };
  }
}

function missatge(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
