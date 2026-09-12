/**
 * Fragments de les categories.
 *
 * Aqui hi ha el cas d'error mes interessant de tota l'aplicacio: esborrar una
 * categoria que te moviments contesta **409**, i la resposta d'aquell 409 no es
 * nomes un avis sino el formulari per triar on han d'anar a parar. Es el mateix
 * que feia l'aplicacio de React amb quatre variables d'estat encadenades,
 * pero decidit al servidor.
 */

import { html, raw } from "hono/html";

import { Select } from "../../components/form.ts";
import type { CategoryKind } from "../../db/schema/index.ts";
import { DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import { oobAttributes } from "../../lib/oob.ts";
import type { CategoryView, CategoryGroup, NodeCategory } from "../../services/categories.ts";

const NAMES_KIND: Record<CategoryKind, string> = {
  expense: "Despeses",
  income: "Ingressos",
  transfer: "Traspassos",
};

const ORDRE_KIND: CategoryKind[] = ["expense", "income", "transfer"];

export interface TreeProps {
  code: string;
  tree: Record<CategoryKind, NodeCategory[]>;
  canEdit: boolean;
  /** Torna'l fora de banda quan el canvi ve d'una altra part de la pagina. */
  oob?: boolean;
}

export function Tree({ code, tree, canEdit, oob = false }: TreeProps): Html {
  return html`<div ${oobAttributes("arbre-categories", oob)} class="arbre">
    ${ORDRE_KIND.map((kind) => {
      const nodes = tree[kind];
      if (nodes.length === 0) return "";
      return html`<section class="superficie targeta">
        <h2>${NAMES_KIND[kind]}</h2>
        ${DataTable({
          columnes: html`<th>Categoria</th>
            <th class="dreta">Moviments</th>
            <th class="dreta">Total</th>
            ${canEdit ? html`<th></th>` : ""}` as Html,
          rows: nodes.flatMap((parent) => [
            Row({ code, category: parent, canEdit, filla: false }),
            ...parent.filles.map((f) => Row({ code, category: f, canEdit, filla: true })),
          ]),
          // Inabastable: la seccio no es dibuixa si el grup es buit.
          empty: "Aquest grup no te cap categoria.",
        })}
      </section>`;
    })}
  </div>` as Html;
}

export interface RowProps {
  code: string;
  category: CategoryView;
  canEdit: boolean;
  filla: boolean;
}

/** Una fila de la taula. Es el que es torna a dibuixar quan es canvia el nom. */
export function Row({ code, category, canEdit, filla }: RowProps): Html {
  const base = `/e/${code}/categories/${category.id}`;

  return html`<tr id="categoria-${category.id}" class="${filla ? "filla" : "pare"}">
    <td>
      <span class="punt" style="background:${category.color}" aria-hidden="true"></span>
      ${filla ? html`<span class="sagnat" aria-hidden="true">›</span>` : ""}
      <span class="nom">${category.name}</span>
      ${
        category.isSystem
          ? html`<span class="etiqueta etiqueta-suau" title="Ve del pla inicial">sistema</span>`
          : ""
      }
    </td>
    <td class="dreta">${String(category.transactionCount)}</td>
    <td class="dreta">${formatMoney(category.totalAmount)}</td>
    ${
      canEdit
        ? html`<td class="accions">
          <button
            type="button"
            class="boto boto-discret"
            hx-get="${base}/fragment/edicio"
            hx-target="#categoria-${category.id}"
            hx-swap="outerHTML"
          >
            Reanomena
          </button>
          ${
            category.isProtected
              ? html`<span
                class="text-suau"
                title="Hi ha logica que depen d'aquesta categoria"
                >no es pot esborrar</span
              >`
              : html`<button
                type="button"
                class="boto boto-discret"
                hx-delete="${base}"
                hx-target="#categoria-${category.id}"
                hx-swap="outerHTML"
                hx-confirm="Segur que vols esborrar «${category.name}»?"
              >
                Esborra
              </button>`
          }
        </td>`
        : ""
    }
  </tr>` as Html;
}

/** La fila convertida en un camp de text, per reanomenar-la sense sortir. */
export function EditRow({ code, category }: { code: string; category: CategoryView }): Html {
  const base = `/e/${code}/categories/${category.id}`;
  return html`<tr id="categoria-${category.id}" class="editant">
    <td colspan="4">
      <form
        class="linia"
        hx-patch="${base}"
        hx-target="#categoria-${category.id}"
        hx-swap="outerHTML"
      >
        <label class="camp camp-linia">
          <span class="camp-etiqueta">Nom</span>
          <input type="text" name="name" value="${category.name}" maxlength="120" autofocus />
        </label>
        <button type="submit" class="boto">Desa</button>
        <button
          type="button"
          class="boto boto-discret"
          hx-get="${base}/fragment/fila"
          hx-target="#categoria-${category.id}"
          hx-swap="outerHTML"
        >
          Cancel·la
        </button>
      </form>
    </td>
  </tr>` as Html;
}

/** Una categoria esborrada desapareix de la taula. */
export function DeletedRow(id: number): Html {
  return html`<tr id="categoria-${id}" hidden></tr>` as Html;
}

export interface ReassignmentFormProps {
  code: string;
  category: CategoryView;
  transactionList: number;
  groups: CategoryGroup[];
}

/**
 * La resposta del 409: no un carreró sense sortida, sino la pregunta que
 * falta. Va dins de la mateixa fila, de manera que surt al costat de la
 * categoria que s'estava esborrant.
 */
export function ReassignmentForm({
  code,
  category,
  transactionList,
  groups,
}: ReassignmentFormProps): Html {
  return html`<tr id="categoria-${category.id}" class="reassignant">
    <td colspan="4">
      <form
        class="linia"
        hx-delete="/e/${code}/categories/${category.id}"
        hx-target="#categoria-${category.id}"
        hx-swap="outerHTML"
      >
        <p class="reassignant-text">
          «${category.name}» te
          ${String(transactionList)} ${transactionList === 1 ? "moviment" : "moviments"}. On han d'anar?
        </p>
        ${Select({
          name: "reassign_to",
          tag: "Mou-los a",
          groups,
          empty: "— tria una categoria —",
        })}
        <button type="submit" class="boto boto-perill">Esborra-la i mou-los</button>
        <button
          type="button"
          class="boto boto-discret"
          hx-get="/e/${code}/categories/${category.id}/fragment/fila"
          hx-target="#categoria-${category.id}"
          hx-swap="outerHTML"
        >
          Cancel·la
        </button>
      </form>
    </td>
  </tr>` as Html;
}

export interface CreateFormProps {
  code: string;
  groups: CategoryGroup[];
  errors?: Record<string, string[]> | undefined;
  values?: { name?: string; kind?: string; parent_id?: string } | undefined;
}

export function CreateForm({ code, groups, errors, values }: CreateFormProps): Html {
  return html`<form
    id="form-categoria"
    class="superficie targeta form-linia"
    hx-post="/e/${code}/categories"
    hx-target="#form-categoria"
    hx-swap="outerHTML"
  >
    <h2>Afegeix una categoria</h2>

    <label class="camp">
      <span class="camp-etiqueta">Nom<abbr title="obligatori">*</abbr></span>
      <input
        type="text"
        name="name"
        value="${values?.name ?? ""}"
        maxlength="120"
        required
        ${errors?.name ? raw('aria-invalid="true" aria-describedby="name-error"') : ""}
      />
      ${errors?.name ? html`<p id="name-error" class="camp-error">${errors.name[0]}</p>` : ""}
    </label>

    ${Select({
      name: "kind",
      tag: "Tipus",
      value: values?.kind ?? "expense",
      options: [
        { value: "expense", text: "Despesa" },
        { value: "income", text: "Ingres" },
        { value: "transfer", text: "Traspas" },
      ],
      errors,
      help: "Si tries un pare, s'hereta el seu i aixo no compta.",
    })}
    ${Select({
      name: "parent_id",
      tag: "Dins de",
      value: values?.parent_id ?? "",
      groups,
      empty: "— cap: sera una categoria principal —",
      errors,
    })}

    <button type="submit" class="boto">Afegeix-la</button>
  </form>` as Html;
}
