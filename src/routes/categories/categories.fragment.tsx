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

import { Tria } from "../../components/form.tsx";
import type { CategoryKind } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { formatMoney } from "../../lib/money.ts";
import type {
  CategoriaVista,
  GrupCategories,
  NodeCategoria,
} from "../../services/categories.ts";

const NOMS_KIND: Record<CategoryKind, string> = {
  expense: "Despeses",
  income: "Ingressos",
  transfer: "Traspassos",
};

const ORDRE_KIND: CategoryKind[] = ["expense", "income", "transfer"];

export interface ArbreProps {
  codi: string;
  arbre: Record<CategoryKind, NodeCategoria[]>;
  potEditar: boolean;
  /** Torna'l fora de banda quan el canvi ve d'una altra part de la pagina. */
  oob?: boolean;
}

export function Arbre({ codi, arbre, potEditar, oob = false }: ArbreProps): Html {
  return html`<div
    id="arbre-categories"
    class="arbre"
    ${oob ? raw('hx-swap-oob="true"') : ""}
  >
    ${ORDRE_KIND.map((kind) => {
      const nodes = arbre[kind];
      if (nodes.length === 0) return "";
      return html`<section class="superficie targeta">
        <h2>${NOMS_KIND[kind]}</h2>
        <div class="desplaçable">
          <table class="dades">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Subscripcio</th>
                <th class="dreta">Moviments</th>
                <th class="dreta">Total</th>
                ${potEditar ? html`<th></th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${nodes.flatMap((pare) => [
                Fila({ codi, categoria: pare, potEditar, filla: false }),
                ...pare.filles.map((f) => Fila({ codi, categoria: f, potEditar, filla: true })),
              ])}
            </tbody>
          </table>
        </div>
      </section>`;
    })}
  </div>` as Html;
}

export interface FilaProps {
  codi: string;
  categoria: CategoriaVista;
  potEditar: boolean;
  filla: boolean;
}

/** Una fila de la taula. Es el que es torna a dibuixar quan es canvia el nom. */
export function Fila({ codi, categoria, potEditar, filla }: FilaProps): Html {
  const base = `/e/${codi}/categories/${categoria.id}`;

  return html`<tr id="categoria-${categoria.id}" class="${filla ? "filla" : "pare"}">
    <td>
      <span class="punt" style="background:${categoria.color}" aria-hidden="true"></span>
      ${filla ? html`<span class="sagnat" aria-hidden="true">›</span>` : ""}
      <span class="nom">${categoria.name}</span>
      ${
        categoria.isSystem
          ? html`<span class="etiqueta etiqueta-suau" title="Ve del pla inicial">sistema</span>`
          : ""
      }
    </td>
    <td>
      ${
        potEditar
          ? html`<input
            type="checkbox"
            name="is_subscription"
            ${categoria.isSubscription ? raw("checked") : ""}
            aria-label="Marca ${categoria.name} com a subscripcio"
            hx-post="${base}/subscripcio"
            hx-target="#categoria-${categoria.id}"
            hx-swap="outerHTML"
          />`
          : categoria.isSubscription
            ? "Si"
            : ""
      }
    </td>
    <td class="dreta">${String(categoria.transactionCount)}</td>
    <td class="dreta">${formatMoney(categoria.totalAmount)}</td>
    ${
      potEditar
        ? html`<td class="accions">
          <button
            type="button"
            class="boto boto-discret"
            hx-get="${base}/fragment/edicio"
            hx-target="#categoria-${categoria.id}"
            hx-swap="outerHTML"
          >
            Reanomena
          </button>
          ${
            categoria.isProtected
              ? html`<span
                class="text-suau"
                title="Hi ha logica que depen d'aquesta categoria"
                >no es pot esborrar</span
              >`
              : html`<button
                type="button"
                class="boto boto-discret"
                hx-delete="${base}"
                hx-target="#categoria-${categoria.id}"
                hx-swap="outerHTML"
                hx-confirm="Segur que vols esborrar «${categoria.name}»?"
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
export function FilaEdicio({
  codi,
  categoria,
}: {
  codi: string;
  categoria: CategoriaVista;
}): Html {
  const base = `/e/${codi}/categories/${categoria.id}`;
  return html`<tr id="categoria-${categoria.id}" class="editant">
    <td colspan="5">
      <form
        class="linia"
        hx-patch="${base}"
        hx-target="#categoria-${categoria.id}"
        hx-swap="outerHTML"
      >
        <label class="camp camp-linia">
          <span class="camp-etiqueta">Nom</span>
          <input type="text" name="name" value="${categoria.name}" maxlength="120" autofocus />
        </label>
        <button type="submit" class="boto">Desa</button>
        <button
          type="button"
          class="boto boto-discret"
          hx-get="${base}/fragment/fila"
          hx-target="#categoria-${categoria.id}"
          hx-swap="outerHTML"
        >
          Cancel·la
        </button>
      </form>
    </td>
  </tr>` as Html;
}

/** Una categoria esborrada desapareix de la taula. */
export function FilaEsborrada(id: number): Html {
  return html`<tr id="categoria-${id}" hidden></tr>` as Html;
}

export interface FormReassignacioProps {
  codi: string;
  categoria: CategoriaVista;
  moviments: number;
  grups: GrupCategories[];
}

/**
 * La resposta del 409: no un carreró sense sortida, sino la pregunta que
 * falta. Va dins de la mateixa fila, de manera que surt al costat de la
 * categoria que s'estava esborrant.
 */
export function FormReassignacio({
  codi,
  categoria,
  moviments,
  grups,
}: FormReassignacioProps): Html {
  return html`<tr id="categoria-${categoria.id}" class="reassignant">
    <td colspan="5">
      <form
        class="linia"
        hx-delete="/e/${codi}/categories/${categoria.id}"
        hx-target="#categoria-${categoria.id}"
        hx-swap="outerHTML"
      >
        <p class="reassignant-text">
          «${categoria.name}» te
          ${String(moviments)} ${moviments === 1 ? "moviment" : "moviments"}. On han d'anar?
        </p>
        ${Tria({
          nom: "reassign_to",
          etiqueta: "Mou-los a",
          grups,
          buit: "— tria una categoria —",
        })}
        <button type="submit" class="boto boto-perill">Esborra-la i mou-los</button>
        <button
          type="button"
          class="boto boto-discret"
          hx-get="/e/${codi}/categories/${categoria.id}/fragment/fila"
          hx-target="#categoria-${categoria.id}"
          hx-swap="outerHTML"
        >
          Cancel·la
        </button>
      </form>
    </td>
  </tr>` as Html;
}

export interface FormAltaProps {
  codi: string;
  grups: GrupCategories[];
  errors?: Record<string, string[]> | undefined;
  valors?: { name?: string; kind?: string; parent_id?: string } | undefined;
}

export function FormAlta({ codi, grups, errors, valors }: FormAltaProps): Html {
  return html`<form
    id="form-categoria"
    class="superficie targeta form-linia"
    hx-post="/e/${codi}/categories"
    hx-target="#form-categoria"
    hx-swap="outerHTML"
  >
    <h2>Afegeix una categoria</h2>

    <label class="camp">
      <span class="camp-etiqueta">Nom<abbr title="obligatori">*</abbr></span>
      <input
        type="text"
        name="name"
        value="${valors?.name ?? ""}"
        maxlength="120"
        required
        ${errors?.name ? raw('aria-invalid="true" aria-describedby="name-error"') : ""}
      />
      ${errors?.name ? html`<p id="name-error" class="camp-error">${errors.name[0]}</p>` : ""}
    </label>

    ${Tria({
      nom: "kind",
      etiqueta: "Tipus",
      valor: valors?.kind ?? "expense",
      opcions: [
        { valor: "expense", text: "Despesa" },
        { valor: "income", text: "Ingres" },
        { valor: "transfer", text: "Traspas" },
      ],
      errors,
      ajuda: "Si tries un pare, s'hereta el seu i aixo no compta.",
    })}
    ${Tria({
      nom: "parent_id",
      etiqueta: "Dins de",
      valor: valors?.parent_id ?? "",
      grups,
      buit: "— cap: sera una categoria principal —",
      errors,
    })}

    <button type="submit" class="boto">Afegeix-la</button>
  </form>` as Html;
}
