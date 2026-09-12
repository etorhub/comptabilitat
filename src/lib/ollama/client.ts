/**
 * Ollama client, for classification with a local model.
 *
 * Translated from `backend/app/integrations/ollama/client.py`.
 */

import { z } from "zod/v4";

import { config } from "../config.ts";
import {
  buildPrompt,
  PROMPT_VERSION,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  type CategoryCatalog,
  type MerchantContext,
} from "./prompts.ts";

/** The local model did not answer, or answered badly. */
export class OllamaError extends Error {
  constructor(text: string) {
    super(text);
    this.name = "OllamaError";
  }
}

export interface Suggestion {
  categorySlug: string;
  confidence: number;
  merchant: string;
  rationale: string;
  model: string;
  promptVersion: string;
}

/** The tags the server has pulled. */
const tagsResponse = z.object({
  models: z.array(z.object({ name: z.string().optional() })).default([]),
});

const chatResponse = z.object({
  message: z.object({ content: z.string().optional() }).optional(),
});

/**
 * The content the model returns. It is JSON inside a string, and the model
 * gets it wrong: `confidence` can arrive as text and `rationale` can be
 * missing. Hence everything is optional here and sanitised in `classify()`.
 */
const content = z.object({
  category_slug: z.string().optional(),
  merchant: z.string().optional(),
  confidence: z.union([z.number(), z.string()]).optional(),
  rationale: z.string().optional(),
});

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  timeoutSeconds?: number;
}

export class OllamaClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutSeconds: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.ollamaBaseUrl).replace(/\/$/, "");
    this.model = options.model ?? config.ollamaModel;
    this.timeoutSeconds = options.timeoutSeconds ?? config.ollamaTimeoutSeconds;
  }

  /** Checks that the service answers and that the model is there. */
  async isAvailable(): Promise<boolean> {
    let data: unknown;
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (error) {
      console.warn(`[ollama] no respon a ${this.baseUrl}: ${message(error)}`);
      return false;
    }

    const names = tagsResponse
      .parse(data)
      .models.map((m) => m.name ?? "")
      .filter((n) => n !== "");

    // Tags can carry a suffix (:latest), so the prefix is what is compared.
    const base = this.model.split(":")[0];
    const isPresent = names.some((name) => name.split(":")[0] === base);
    if (!isPresent) {
      console.warn(
        `[ollama] el model ${this.model} no esta descarregat (n'hi ha ${names.toSorted().join(", ")})`,
      );
    }
    return isPresent;
  }

  /** Asks for a merchant's category. Throws `OllamaError` on failure. */
  async classify(
    context: MerchantContext,
    categories: readonly CategoryCatalog[],
  ): Promise<Suggestion> {
    const body = {
      model: this.model,
      stream: false,
      format: RESPONSE_SCHEMA,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(context, categories) },
      ],
      options: {
        // Deterministic: the same input has to give the same output.
        temperature: 0,
        num_predict: 200,
      },
    };

    let data: unknown;
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutSeconds * 1000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (error) {
      throw new OllamaError(`Ollama no ha respost: ${message(error)}`);
    }

    const text = chatResponse.parse(data).message?.content ?? "";
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new OllamaError(`Resposta no interpretable: ${text.slice(0, 200)}`);
    }

    const analyzed = content.safeParse(raw);
    if (!analyzed.success) {
      throw new OllamaError(`Resposta no interpretable: ${text.slice(0, 200)}`);
    }

    const slug = (analyzed.data.category_slug ?? "").trim();
    if (slug === "") {
      throw new OllamaError("La resposta no porta cap categoria");
    }

    const confidence = Number(analyzed.data.confidence ?? 0);

    return {
      categorySlug: slug,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      merchant: (analyzed.data.merchant ?? "").slice(0, 200),
      rationale: (analyzed.data.rationale ?? "").slice(0, 500),
      model: this.model,
      promptVersion: PROMPT_VERSION,
    };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
