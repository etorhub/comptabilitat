/**
 * Els sondejos de l'aplicacio.
 *
 * N'hi ha dos —l'estat d'una importacio a `/connexions` i les feines en curs a
 * `/feines`— i son l'unica excepcio de la regla de l'`AGENTS.md` que diu que no
 * se sondeja mai.
 *
 * Tots dos s'aturaven **nomes** quan el servidor deia que la feina havia
 * acabat. Aixo es correcte mentre la feina acabi. Quan no acaba —un
 * `docker compose stop` enmig d'una importacio deixa la fila en `running` per
 * sempre— la pagina s'ho continua preguntant cada dos segons, indefinidament i
 * per a tothom qui la miri. Va passar (`f80df91`), i el sondeig no en deia res:
 * el marcatge d'un que s'aturara i el d'un que no s'aturara mai son identics.
 *
 * Ara el compte de vegades viatja **a l'adreça que se sondeja**. Es
 * server-authoritative i sense estat de client, com tota la resta de
 * l'aplicacio: cada resposta demana l'intent seguent, i quan s'acaben el
 * fragment deixa d'emetre disparador i ensenya que s'ha aturat.
 *
 * Aquest fitxer es la capa prima en catala; el mecanisme es a
 * `htmx-contract/poll.ts`, en angles, perque ha de poder marxar amb la resta.
 */

import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

import { pollAttributes, readAttempt } from "../../htmx-contract/poll.ts";

/** El parametre on viatja el compte. */
export const ATTEMPT_PARAM = "intent";

/**
 * Trenta minuts a dos segons.
 *
 * Generos a proposit. El manteniment de cada nit ja tanca les importacions que
 * fa mes de dues hores que no es mouen, i sota PSD2 una importacio viva de debo
 * impedeix començar-ne una altra: val mes que el sondeig es rendeixi tard que
 * no pas que es rendeixi mentre la feina encara corre.
 */
export const MAX_ATTEMPTS = 900;

export interface PollOptions {
  /** L'adreça del fragment que se sondeja. */
  url: string;
  /** On va la resposta. */
  target: string;
  /** Quin intent ha dibuixat aixo. El primer es 0. */
  attempt: number;
  /** Cada quants segons. */
  cadaSegons?: number;
  maxIntents?: number;
}

/**
 * Els atributs per a un intent mes, o `""` si ja no en queden.
 *
 * Qui el crida ha de mirar `sondeigExhaurit()` per ensenyar que s'ha aturat:
 * no n'hi ha prou de deixar d'emetre el disparador en silenci, perque llavors
 * la pagina es queda ensenyant un filador que no avançara mai.
 */
export function poll(options: PollOptions): HtmlEscapedString | "" {
  const attributes = pollAttributes({
    url: options.url,
    target: options.target,
    everyMs: (options.cadaSegons ?? 2) * 1000,
    attempt: options.attempt,
    maxAttempts: options.maxIntents ?? MAX_ATTEMPTS,
    attemptParam: ATTEMPT_PARAM,
  });
  return attributes === null ? "" : (raw(attributes) as HtmlEscapedString);
}

/** Si aquest intent ja es fora del limit. */
export function pollExhausted(attempt: number, maxIntents = MAX_ATTEMPTS): boolean {
  return attempt >= maxIntents;
}

/** El compte d'intents que ve de la cadena de consulta. */
export function attemptFromQuery(valor: string | null | undefined): number {
  return readAttempt(valor);
}
