/**
 * The markup type.
 *
 * Hono's `html` tag returns `HtmlEscapedString` or a promise of one, depending
 * on whether what is inside it is asynchronous. In practice it does not matter
 * — both render the same way — but it needs saying once instead of repeating
 * it, or casting, in every component.
 */

import type { HtmlEscapedString } from "hono/utils/html";

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
