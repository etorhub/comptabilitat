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

/** Every three seconds: a CPU answer takes tens of seconds and there is no hurry. */
export const POLL_SECONDS = 3;

/**
 * How long the page waits for one answer: the model's timeout plus a margin for
 * whatever is queued ahead of it. After that it stops asking and says so.
 */
export function pollAttempts(): number {
  return Math.ceil((config.ollamaChatTimeoutSeconds + 120) / POLL_SECONDS);
}
