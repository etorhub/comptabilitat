/**
 * Ollama client: classification, the chat and the written reports.
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
import { REPORT_RESPONSE_SCHEMA } from "./report-prompts.ts";

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

export interface ChatModelOptions {
  baseUrl?: string;
  model?: string;
  timeoutSeconds?: number;
}

/** What the chat needs from a model. The tests pass a fake with this shape. */
export interface ChatModel {
  readonly model: string;
  /** One call: the parsed JSON, or `null` if the reply is not JSON. Throws `OllamaError` when unreachable. */
  interpret(system: string, prompt: string, schema: object): Promise<unknown>;
}

export class OllamaChatModel implements ChatModel {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutSeconds: number;

  constructor(options: ChatModelOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.ollamaBaseUrl).replace(/\/$/, "");
    this.model = options.model ?? config.ollamaChatModel;
    this.timeoutSeconds = options.timeoutSeconds ?? config.ollamaChatTimeoutSeconds;
  }

  async interpret(system: string, prompt: string, schema: object): Promise<unknown> {
    const body = {
      model: this.model,
      stream: false,
      format: schema,
      // Reasoning models (qwen3) would otherwise think for minutes on a CPU
      // before writing a dozen tokens of JSON.
      think: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      options: { temperature: 0, num_predict: 300 },
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

    // A reply that is not JSON is the model not understanding, not the model
    // being down: the caller turns `null` into «I cannot do that».
    const text = chatResponse.parse(data).message?.content ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

/** What a written report looks like once the model has answered. */
export interface ReportText {
  resum: string;
  punts: string[];
}

/** What the reports need from a model. The tests pass a fake with this shape. */
export interface ReportModel {
  readonly model: string;
  /** One call. Throws `OllamaError` when unreachable or when the answer is unusable. */
  write(system: string, prompt: string): Promise<ReportText>;
}

const reportContent = z.object({
  resum: z.string().trim().min(1),
  punts: z.array(z.string()).default([]),
});

export class OllamaReportModel implements ReportModel {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutSeconds: number;

  constructor(options: ChatModelOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.ollamaBaseUrl).replace(/\/$/, "");
    this.model = options.model ?? config.ollamaReportModel;
    this.timeoutSeconds = options.timeoutSeconds ?? config.ollamaReportTimeoutSeconds;
  }

  async write(system: string, prompt: string): Promise<ReportText> {
    const body = {
      model: this.model,
      stream: false,
      format: REPORT_RESPONSE_SCHEMA,
      // Same as the chat: without it qwen3 spends minutes thinking on a CPU.
      think: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      // A little warmth for prose; the figures are pinned down by the prompt.
      options: { temperature: 0.3, num_predict: 700 },
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

    const parsed = reportContent.safeParse(raw);
    if (!parsed.success) {
      throw new OllamaError(`Resposta no interpretable: ${text.slice(0, 200)}`);
    }

    return {
      resum: parsed.data.resum.slice(0, 2000),
      punts: parsed.data.punts
        .map((p) => p.trim())
        .filter((p) => p !== "")
        .slice(0, 8)
        .map((p) => p.slice(0, 500)),
    };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
