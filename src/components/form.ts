/**
 * Form pieces.
 *
 * One pattern for validation errors across the whole application: the field is
 * marked `aria-invalid`, the message goes in a `<p>` with an id, and the field
 * points at it with `aria-describedby`. A screen reader then says it without
 * anything having to move the focus.
 *
 * Whatever the person typed is always returned: a form that empties itself
 * when validation fails is a way of making people angry.
 */

import { html, raw } from "hono/html";
import type { Html } from "../lib/html.ts";

/** Per-field errors, as `zodErrors()` produces them. */
export type FieldErrors = Record<string, string[]>;

/** Turns a `ZodError` into the map these components expect. */
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

/** A field's first error message, if it has one. */
export function fieldError(errors: FieldErrors | undefined, field: string): string | undefined {
  return errors?.[field]?.[0];
}

interface FieldProps {
  name: string;
  tag: string;
  type?: string;
  value?: string | number | null | undefined;
  errors?: FieldErrors | undefined;
  required?: boolean;
  help?: string;
  autocomplete?: string;
  autofocus?: boolean;
  maxlength?: number;
  step?: string;
  placeholder?: string;
  /** See `SelectProps.id`: needed when the field is rendered more than once. */
  id?: string;
}

export function Field(props: FieldProps): Html {
  const {
    name,
    tag,
    type = "text",
    value,
    errors,
    required = false,
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
  const describe = [error ? idError : null, help ? helpId : null].filter(Boolean).join(" ");

  return html`<label class="camp">
    <span class="camp-etiqueta">${tag}${required ? html`<abbr title="obligatori">*</abbr>` : ""}</span>
    <input
      type="${type}"
      name="${name}"
      id="${id}"
      value="${value ?? ""}"
      ${required ? raw("required") : ""}
      ${autofocus ? raw("autofocus") : ""}
      ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : ""}
      ${maxlength ? raw(`maxlength="${maxlength}"`) : ""}
      ${step ? raw(`step="${step}"`) : ""}
      ${placeholder ? raw(`placeholder="${placeholder}"`) : ""}
      ${error ? raw('aria-invalid="true"') : ""}
      ${describe ? raw(`aria-describedby="${describe}"`) : ""}
    />
    ${help ? html`<small id="${helpId}" class="camp-ajuda">${help}</small>` : ""}
    ${error ? html`<p id="${idError}" class="camp-error">${error}</p>` : ""}
  </label>` as Html;
}

export interface Option {
  value: string | number;
  text: string;
}

export interface OptionsGroup {
  tag: string;
  options: Option[];
}

interface SelectProps {
  name: string;
  tag: string;
  value?: string | number | null | undefined;
  /** Flat options, or groups for an `<optgroup>`. */
  options?: Option[];
  groups?: OptionsGroup[];
  /** The empty option's text. Without one, the field is effectively required. */
  empty?: string;
  errors?: FieldErrors | undefined;
  help?: string;
  attributes?: string;
  /**
   * The element's `id`. It defaults to the field's name, but **when the same
   * field is rendered more than once on a page (one row per transaction, say)
   * it needs its own**: two elements with the same `id` are invalid HTML and
   * make every `aria-describedby` point at the first one.
   */
  id?: string;
}

/**
 * A native select.
 *
 * This is what replaces the previous application's 372-line
 * `SelectorCategoria`. The category plan is around 60 items on two levels,
 * which is exactly what an `<optgroup>` knows how to do: keyboard navigation,
 * type-ahead and accessibility, for free and without JavaScript.
 */
export function Select(props: SelectProps): Html {
  const { name, tag, value, options, groups, empty, errors, help, attributes } = props;
  const id = props.id ?? name;
  const error = fieldError(errors, name);
  const idError = `${id}-error`;
  const currentValue = value === null || value === undefined ? "" : String(value);

  const option = (o: Option) =>
    html`<option value="${o.value}" ${String(o.value) === currentValue ? raw("selected") : ""}>
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
          ? html`<option value="" ${currentValue === "" ? raw("selected") : ""}>${empty}</option>`
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
  marked?: boolean;
  attributes?: string;
  value?: string;
}

export function Checkbox(props: CheckboxProps): Html {
  const { name, tag, marked = false, attributes, value } = props;
  return html`<label class="casella">
    <input
      type="checkbox"
      name="${name}"
      ${value ? raw(`value="${value}"`) : ""}
      ${marked ? raw("checked") : ""}
      ${attributes ? raw(attributes) : ""}
    />
    <span>${tag}</span>
  </label>` as Html;
}

/**
 * An error that belongs to no particular field (the `_` key), shown at the top
 * of the form.
 */
export function FormError(errors: FieldErrors | undefined) {
  const message = fieldError(errors, "_");
  if (!message) return "";
  return html`<p class="form-error" role="alert">${message}</p>`;
}
