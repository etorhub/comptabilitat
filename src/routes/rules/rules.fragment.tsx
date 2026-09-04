/**
 * Fragments de les regles.
 */

import { html, raw } from "hono/html";

import { Tria } from "../../components/form.tsx";
import { RULE_FIELDS, RULE_OPERATORS, type Rule } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import {
  condicioLlegible,
  condicionsDe,
  NOMS_CAMP,
  NOMS_OPERADOR,
} from "../../services/rules.ts";
import type { FieldErrors } from "../../components/form.tsx";

export interface ReglaVista extends Rule {
  categoryName: string | null;
}

export interface LlistaProps {
  codi: string;
  regles: ReglaVista[];
  potEditar: boolean;
  /** Torna-la fora de banda quan el canvi ve del formulari d'alta. */
  oob?: boolean;
}

export function Llista({ codi, regles, potEditar, oob = false }: LlistaProps): Html {
  return html`<div id="llista-regles" ${oob ? raw('hx-swap-oob="true"') : ""}>
    ${
      regles.length === 0
        ? html`<p class="buit text-suau">
          Encara no hi ha cap regla. Les regles s'apliquen abans que la memoria
          de comerços, i la primera que encaixa guanya.
        </p>`
        : html`<div class="desplaçable">
          <table class="dades">
            <thead>
              <tr>
                <th class="dreta">Prioritat</th>
                <th>Regla</th>
                <th>Assigna</th>
                <th class="dreta">Encaixos</th>
                ${potEditar ? html`<th></th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${regles.map((regla) => Fila({ codi, regla, potEditar }))}
            </tbody>
          </table>
        </div>`
    }
  </div>` as Html;
}

export function Fila({
  codi,
  regla,
  potEditar,
}: {
  codi: string;
  regla: ReglaVista;
  potEditar: boolean;
}): Html {
  const base = `/e/${codi}/regles/${regla.id}`;
  const condicions = condicionsDe(regla);

  return html`<tr id="regla-${regla.id}" class="${regla.isActive ? "" : "inactiva"}">
    <td class="dreta">${String(regla.priority)}</td>
    <td>
      <span class="nom">${regla.name}</span>
      ${
        regla.source === "learned"
          ? html`<span class="etiqueta etiqueta-suau" title="Creada en corregir un moviment"
            >apresa</span
          >`
          : ""
      }
      ${regla.isActive ? "" : html`<span class="etiqueta etiqueta-suau">aturada</span>`}
      <ul class="condicions">
        ${condicions.map((c) => html`<li>${condicioLlegible(c)}</li>`)}
      </ul>
    </td>
    <td>
      ${regla.categoryName ?? html`<span class="text-suau">—</span>`}
      ${
        regla.setTags.length > 0
          ? html`<div class="etiquetes">
            ${regla.setTags.map((t) => html`<span class="etiqueta etiqueta-suau">${t}</span>`)}
          </div>`
          : ""
      }
    </td>
    <td class="dreta">${String(regla.matchCount)}</td>
    ${
      potEditar
        ? html`<td class="accions">
          <button
            type="button"
            class="boto boto-discret"
            hx-post="${base}/aplica"
            hx-target="#regla-${regla.id}"
            hx-swap="outerHTML"
          >
            Torna-la a aplicar
          </button>
          <button
            type="button"
            class="boto boto-discret"
            hx-post="${base}/activa"
            hx-target="#regla-${regla.id}"
            hx-swap="outerHTML"
          >
            ${regla.isActive ? "Atura-la" : "Activa-la"}
          </button>
          <button
            type="button"
            class="boto boto-discret"
            hx-delete="${base}"
            hx-target="#regla-${regla.id}"
            hx-swap="outerHTML"
            hx-confirm="Segur que vols esborrar «${regla.name}»?"
          >
            Esborra
          </button>
        </td>`
        : ""
    }
  </tr>` as Html;
}

export function FilaEsborrada(id: number): Html {
  return html`<tr id="regla-${id}" hidden></tr>` as Html;
}

export interface FormAltaProps {
  codi: string;
  grups: GrupCategories[];
  errors?: FieldErrors | undefined;
  valors?: Record<string, string> | undefined;
}

/**
 * Formulari d'alta.
 *
 * Les files de condicions son camps repetits (`field`, `operator`, `value`) i
 * el boto d'afegir-ne una en clona una de buida. Son sis linies de JavaScript
 * i cap estat: el formulari s'envia sencer i el servidor el torna a muntar.
 */
export function FormAlta({ codi, grups, errors, valors }: FormAltaProps): Html {
  return html`<form
    id="form-regla"
    class="superficie targeta"
    hx-post="/e/${codi}/regles"
    hx-target="#form-regla"
    hx-swap="outerHTML"
  >
    <h2>Afegeix una regla</h2>

    ${
      errors?.conditions
        ? html`<p class="form-error" role="alert">${errors.conditions[0]}</p>`
        : ""
    }

    <div class="form-linia">
      <label class="camp camp-linia">
        <span class="camp-etiqueta">Nom<abbr title="obligatori">*</abbr></span>
        <input
          type="text"
          name="name"
          value="${valors?.name ?? ""}"
          maxlength="160"
          required
          ${errors?.name ? raw('aria-invalid="true"') : ""}
        />
        ${errors?.name ? html`<p class="camp-error">${errors.name[0]}</p>` : ""}
      </label>

      <label class="camp camp-linia camp-estret">
        <span class="camp-etiqueta">Prioritat</span>
        <input
          type="number"
          name="priority"
          value="${valors?.priority ?? "100"}"
          min="0"
          max="10000"
        />
        <small class="camp-ajuda">Mes baix, abans.</small>
      </label>

      ${Tria({
        nom: "set_category_id",
        etiqueta: "Assigna la categoria",
        valor: valors?.set_category_id ?? "",
        grups,
        buit: "— cap —",
      })}
    </div>

    <label class="camp">
      <span class="camp-etiqueta">Etiquetes</span>
      <input
        type="text"
        name="set_tags"
        value="${valors?.set_tags ?? ""}"
        maxlength="200"
        placeholder="casament, projecteX"
        ${errors?.set_tags ? raw('aria-invalid="true"') : ""}
      />
      <small class="camp-ajuda">Separades per comes. Opcional.</small>
      ${errors?.set_tags ? html`<p class="camp-error">${errors.set_tags[0]}</p>` : ""}
    </label>

    <fieldset class="condicions-camp">
      <legend>Condicions (s'han de complir totes)</legend>
      <div id="files-condicions">${FilaCondicio()}</div>
      <button
        type="button"
        class="boto boto-discret"
        onclick="var c=document.getElementById('files-condicions');var f=c.firstElementChild.cloneNode(true);f.querySelector(&quot;input[name='value']&quot;).value='';c.appendChild(f)"
      >
        Afegeix una condicio
      </button>
    </fieldset>

    <label class="casella">
      <input type="checkbox" name="apply_now" checked />
      <span>Aplica-la ara als moviments que ja hi ha</span>
    </label>

    <div class="form-accions">
      <button type="submit" class="boto">Crea la regla</button>
    </div>
  </form>` as Html;
}

function FilaCondicio(): Html {
  return html`<div class="fila-condicio">
    <select name="field" aria-label="Camp">
      ${RULE_FIELDS.map((f) => html`<option value="${f}">${NOMS_CAMP[f]}</option>`)}
    </select>
    <select name="operator" aria-label="Operador">
      ${RULE_OPERATORS.map((o) => html`<option value="${o}">${NOMS_OPERADOR[o]}</option>`)}
    </select>
    <input type="text" name="value" placeholder="Valor" aria-label="Valor" />
  </div>` as Html;
}
