/**
 * El tipus del marcatge.
 *
 * L'etiqueta `html` de Hono retorna `HtmlEscapedString` o una promesa, segons
 * si el que hi ha dins es asincron. A la practica no importa —tot dos es
 * renderitzen igual— pero cal dir-ho un cop i no anar-ho repetint ni fent
 * conversions a cada component.
 */

import type { HtmlEscapedString } from "hono/utils/html";

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
