/**
 * Peces de formulari.
 *
 * Un sol patro per als errors de validacio a tota l'aplicacio: el camp es
 * marca amb `aria-invalid`, el missatge va en un `<p>` amb identificador, i
 * el camp l'apunta amb `aria-describedby`. Aixi ho diu un lector de pantalla
 * sense que calgui moure el focus enlloc.
 *
 * Els valors que ha escrit la persona es tornen sempre: un formulari que
 * s'esborra quan falla la validacio es una manera de fer enfadar la gent.
 */

import { html, raw } from "hono/html";
import type { Html } from "../lib/html.ts";


/** Errors per camp, tal com surten de `zodErrors()`. */
export type FieldErrors = Record<string, string[]>;

/** Converteix un `ZodError` en el mapa que esperen aquests components. */
export function zodErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const clau = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    (errors[clau] ??= []).push(issue.message);
  }
  return errors;
}

/** El primer missatge d'error d'un camp, si n'hi ha. */
export function fieldError(errors: FieldErrors | undefined, camp: string): string | undefined {
  return errors?.[camp]?.[0];
}

interface CampProps {
  nom: string;
  etiqueta: string;
  tipus?: string;
  valor?: string | number | null | undefined;
  errors?: FieldErrors | undefined;
  requerit?: boolean;
  ajuda?: string;
  autocomplete?: string;
  autofocus?: boolean;
  maxlength?: number;
  step?: string;
  placeholder?: string;
}

export function Camp(props: CampProps): Html {
  const {
    nom,
    etiqueta,
    tipus = "text",
    valor,
    errors,
    requerit = false,
    ajuda,
    autocomplete,
    autofocus = false,
    maxlength,
    step,
    placeholder,
  } = props;

  const error = fieldError(errors, nom);
  const idError = `${nom}-error`;
  const idAjuda = `${nom}-ajuda`;
  const descriu = [error ? idError : null, ajuda ? idAjuda : null].filter(Boolean).join(" ");

  return html`<label class="camp">
    <span class="camp-etiqueta">${etiqueta}${requerit ? html`<abbr title="obligatori">*</abbr>` : ""}</span>
    <input
      type="${tipus}"
      name="${nom}"
      id="${nom}"
      value="${valor ?? ""}"
      ${requerit ? raw("required") : ""}
      ${autofocus ? raw("autofocus") : ""}
      ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : ""}
      ${maxlength ? raw(`maxlength="${maxlength}"`) : ""}
      ${step ? raw(`step="${step}"`) : ""}
      ${placeholder ? raw(`placeholder="${placeholder}"`) : ""}
      ${error ? raw('aria-invalid="true"') : ""}
      ${descriu ? raw(`aria-describedby="${descriu}"`) : ""}
    />
    ${ajuda ? html`<small id="${idAjuda}" class="camp-ajuda">${ajuda}</small>` : ""}
    ${error ? html`<p id="${idError}" class="camp-error">${error}</p>` : ""}
  </label>` as Html;
}

export interface Opcio {
  valor: string | number;
  text: string;
}

export interface GrupOpcions {
  etiqueta: string;
  opcions: Opcio[];
}

interface TriaProps {
  nom: string;
  etiqueta: string;
  valor?: string | number | null | undefined;
  /** Opcions planes, o grups per a un `<optgroup>`. */
  opcions?: Opcio[];
  grups?: GrupOpcions[];
  /** Text de l'opcio buida. Si no n'hi ha, el camp es obligatori de fet. */
  buit?: string;
  errors?: FieldErrors | undefined;
  ajuda?: string;
  atributs?: string;
}

/**
 * Selector natiu.
 *
 * Aixo es el que substitueix el `SelectorCategoria` de 372 linies de
 * l'aplicacio anterior. El pla de categories son uns 60 elements en dos
 * nivells, que es exactament el que un `<optgroup>` sap fer: navegacio amb
 * teclat, cerca escrivint i accessibilitat, de franc i sense JavaScript.
 */
export function Tria(props: TriaProps): Html {
  const { nom, etiqueta, valor, opcions, grups, buit, errors, ajuda, atributs } = props;
  const error = fieldError(errors, nom);
  const idError = `${nom}-error`;
  const valorActual = valor === null || valor === undefined ? "" : String(valor);

  const opcio = (o: Opcio) =>
    html`<option value="${o.valor}" ${String(o.valor) === valorActual ? raw("selected") : ""}>
      ${o.text}
    </option>`;

  return html`<label class="camp">
    <span class="camp-etiqueta">${etiqueta}</span>
    <select
      name="${nom}"
      id="${nom}"
      ${error ? raw('aria-invalid="true"') : ""}
      ${error ? raw(`aria-describedby="${idError}"`) : ""}
      ${atributs ? raw(atributs) : ""}
    >
      ${buit !== undefined
        ? html`<option value="" ${valorActual === "" ? raw("selected") : ""}>${buit}</option>`
        : ""}
      ${opcions?.map(opcio) ?? ""}
      ${grups?.map(
        (g) => html`<optgroup label="${g.etiqueta}">${g.opcions.map(opcio)}</optgroup>`,
      ) ?? ""}
    </select>
    ${ajuda ? html`<small class="camp-ajuda">${ajuda}</small>` : ""}
    ${error ? html`<p id="${idError}" class="camp-error">${error}</p>` : ""}
  </label>` as Html;
}

interface CasellaProps {
  nom: string;
  etiqueta: string;
  marcat?: boolean;
  atributs?: string;
  valor?: string;
}

export function Casella(props: CasellaProps): Html {
  const { nom, etiqueta, marcat = false, atributs, valor } = props;
  return html`<label class="casella">
    <input
      type="checkbox"
      name="${nom}"
      ${valor ? raw(`value="${valor}"`) : ""}
      ${marcat ? raw("checked") : ""}
      ${atributs ? raw(atributs) : ""}
    />
    <span>${etiqueta}</span>
  </label>` as Html;
}

/**
 * Error que no es de cap camp en concret (la clau `_`), per ensenyar-lo a
 * dalt del formulari.
 */
export function ErrorGeneral(errors: FieldErrors | undefined) {
  const missatge = fieldError(errors, "_");
  if (!missatge) return "";
  return html`<p class="form-error" role="alert">${missatge}</p>`;
}
