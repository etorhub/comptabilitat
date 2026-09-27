/**
 * Schemas of the chat resource.
 *
 * The keys are the wire format, so they stay Catalan: `pregunta` is the name of
 * the form field.
 */

import { z } from "zod/v4";

import { config } from "../../lib/config.ts";
import { MAX_QUESTION } from "../../services/chat.ts";

export const questionSchema = z.object({
  pregunta: z
    .string()
    .trim()
    .min(1, "Escriu una pregunta")
    .max(MAX_QUESTION, `Com a molt ${MAX_QUESTION} caràcters`),
});

/**
 * Deleting from the sidebar says which conversation is open (`actual`, empty on
 * the new-conversation page), so deleting another one only redraws the list
 * instead of leaving the page. The header's button sends no `actual`.
 */
export const deleteSchema = z.object({
  actual: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : null;
    }),
});

/** Every three seconds: a CPU answer takes tens of seconds and there is no hurry. */
export const POLL_SECONDS = 3;

/**
 * How long the page waits for one answer: the model's timeout plus a margin for
 * whatever is queued ahead of it. After that it stops asking and says so.
 */
export function pollAttempts(): number {
  return Math.ceil((config.ollamaChatTimeoutSeconds + 120) / POLL_SECONDS);
}
