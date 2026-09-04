/**
 * Pagina de moviments.
 */

import { html, raw } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { ItemRevisio, PaginaMoviments } from "../../services/transactions.ts";
import { BarraFiltres, CuaRevisio, Taula } from "./transactions.fragment.tsx";
import {
  teFiltresActius,
  transactionFiltersToQuery,
  type TransactionFilters,
} from "./transactions.schema.ts";

export interface TransactionsPageProps {
  codi: string;
  pagina: PaginaMoviments;
  grups: GrupCategories[];
  comptes: { valor: number; text: string }[];
  filters: TransactionFilters;
  potEditar: boolean;
  etiquetesConegudes?: string[];
}

export function TransactionsPage(props: TransactionsPageProps): Html {
  const {
    codi,
    pagina,
    grups,
    comptes,
    filters,
    potEditar,
    etiquetesConegudes = [],
  } = props;
  // El que et descarregues es el que estas veient: els mateixos filtres.
  const consulta = transactionFiltersToQuery(filters);
  const cercaOberta = teFiltresActius(filters);

  return html`
    <div class="moviments-pagina">
      <input
        type="checkbox"
        id="cerca-oberta"
        class="toggle-cerca visualment-ocult"
        ${cercaOberta ? raw("checked") : ""}
      />
      <header class="capçalera capçalera-fila">
        <h1>Moviments</h1>
        <div class="capçalera-accions">
          <a class="boto boto-discret" href="/e/${codi}/moviments/moviments.csv${consulta}">
            Descarrega en CSV
          </a>
          <label for="cerca-oberta" class="boto boto-discret">Cerca</label>
        </div>
      </header>

      ${BarraFiltres({ codi, filters, comptes, grups, etiquetesConegudes })}
      ${Taula({ codi, pagina, grups, filters, potEditar, etiquetesConegudes })}
    </div>
  ` as Html;
}

export interface ReviewPageProps {
  codi: string;
  items: ItemRevisio[];
  grups: GrupCategories[];
  total: number;
}

export function ReviewPage({ codi, items, grups, total }: ReviewPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Per revisar</h1>
      <p class="text-suau">
        El model local no confirma res pel seu compte: proposa una categoria i
        aqui la confirmes tu. El que confirmis es recorda per a tot el comerç
        d'aquest espai.
      </p>
    </header>

    ${CuaRevisio({ codi, items, grups, total })}
  ` as Html;
}
