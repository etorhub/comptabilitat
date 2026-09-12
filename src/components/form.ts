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
export function zodErrors(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/** El primer missatge d'error d'un camp, si n'hi ha. */
export function fieldError(errors: FieldErrors | undefined, field: string): string | undefined {
  return errors?.[field]?.[0];
}

interface FieldProps {
  name: string;
  tag: string;
  type?: string;
  valor?: string | number | null | undefined;
  errors?: FieldErrors | undefined;
  requerit?: boolean;
  help?: string;
  autocomplete?: string;
  autofocus?: boolean;
  maxlength?: number;
  step?: string;
  placeholder?: string;
  /** Vegeu `TriaProps.id`: cal quan el camp es dibuixa mes d'un cop. */
  id?: string;
}

export function Field(props: FieldProps): Html {
  const {
    name,
    tag,
    type = "text",
    valor,
    errors,
    requerit = false,
    help,
    autocomplete,
    autofocus = false,
    maxlength,
    step,
    placeholder,
  } = props;

  const id = props.id ?? name;
  const error = fieldError(errors, name);
  const idError = `${id}-error`;
  const helpId = `${id}-ajuda`;
  const descriu = [error ? idError : null, help ? helpId : null].filter(Boolean).join(" ");

  return html`<label class="camp">
    <span class="camp-etiqueta">${tag}${requerit ? html`<abbr title="obligatori">*</abbr>` : ""}</span>
    <input
      type="${type}"
      name="${name}"
      id="${id}"
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
    ${help ? html`<small id="${helpId}" class="camp-ajuda">${help}</small>` : ""}
    ${error ? html`<p id="${idError}" class="camp-error">${error}</p>` : ""}
  </label>` as Html;
}

export interface Option {
  valor: string | number;
  text: string;
}

export interface OptionsGroup {
  tag: string;
  options: Option[];
}

interface SelectProps {
  name: string;
  tag: string;
  valor?: string | number | null | undefined;
  /** Opcions planes, o grups per a un `<optgroup>`. */
  options?: Option[];
  groups?: OptionsGroup[];
  /** Text de l'opcio buida. Si no n'hi ha, el camp es obligatori de fet. */
  empty?: string;
  errors?: FieldErrors | undefined;
  help?: string;
  attributes?: string;
  /**
   * L'`id` de l'element. Per defecte es el nom del camp, pero **quan el
   * mateix camp es dibuixa mes d'un cop a la pagina (una fila per moviment,
   * per exemple) cal donar-n'hi un de propi**: dos elements amb el mateix
   * `id` son HTML invalid i fan que l'`aria-describedby` apunti al primer.
   */
  id?: string;
}

/**
 * Selector natiu.
 *
 * Aixo es el que substitueix el `SelectorCategoria` de 372 linies de
 * l'aplicacio anterior. El pla de categories son uns 60 elements en dos
 * nivells, que es exactament el que un `<optgroup>` sap fer: navegacio amb
 * teclat, cerca escrivint i accessibilitat, de franc i sense JavaScript.
 */
export function Select(props: SelectProps): Html {
  const { name, tag, valor, options, groups, empty, errors, help, attributes } = props;
  const id = props.id ?? name;
  const error = fieldError(errors, name);
  const idError = `${id}-error`;
  const valorActual = valor === null || valor === undefined ? "" : String(valor);

  const option = (o: Option) =>
    html`<option value="${o.valor}" ${String(o.valor) === valorActual ? raw("selected") : ""}>
      ${o.text}
    </option>`;

  return html`<label class="camp">
    <span class="camp-etiqueta">${tag}</span>
    <select
      name="${name}"
      id="${id}"
      ${error ? raw('aria-invalid="true"') : ""}
      ${error ? raw(`aria-describedby="${idError}"`) : ""}
      ${attributes ? raw(attributes) : ""}
    >
      ${
        empty !== undefined
          ? html`<option value="" ${valorActual === "" ? raw("selected") : ""}>${empty}</option>`
          : ""
      }
      ${options?.map(option) ?? ""}
      ${
        groups?.map(
          (g) => html`<optgroup label="${g.tag}">${g.options.map(option)}</optgroup>`,
        ) ?? ""
      }
    </select>
    ${help ? html`<small class="camp-ajuda">${help}</small>` : ""}
    ${error ? html`<p id="${idError}" class="camp-error">${error}</p>` : ""}
  </label>` as Html;
}

interface CheckboxProps {
  name: string;
  tag: string;
  marcat?: boolean;
  attributes?: string;
  valor?: string;
}

export function Checkbox(props: CheckboxProps): Html {
  const { name, tag, marcat = false, attributes, valor } = props;
  return html`<label class="casella">
    <input
      type="checkbox"
      name="${name}"
      ${valor ? raw(`value="${valor}"`) : ""}
      ${marcat ? raw("checked") : ""}
      ${attributes ? raw(attributes) : ""}
    />
    <span>${tag}</span>
  </label>` as Html;
}

/**
 * Error que no es de cap camp en concret (la clau `_`), per ensenyar-lo a
 * dalt del formulari.
 */
export function FormError(errors: FieldErrors | undefined) {
  const message = fieldError(errors, "_");
  if (!message) return "";
  return html`<p class="form-error" role="alert">${message}</p>`;
}
