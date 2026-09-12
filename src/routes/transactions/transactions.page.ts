/**
 * Pagina de moviments.
 */

import { html, raw } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type { ReviewItem, TransactionsPage } from "../../services/transactions.ts";
import { FilterBar, ReviewQueue, Table } from "./transactions.fragment.ts";
import {
  hasActiveFilters,
  transactionFiltersToQuery,
  type TransactionFilters,
} from "./transactions.schema.ts";

export interface TransactionsPageProps {
  codi: string;
  page: TransactionsPage;
  groups: CategoryGroup[];
  accountList: { valor: number; text: string }[];
  filters: TransactionFilters;
  potEditar: boolean;
  etiquetesConegudes?: string[];
  targetesConegudes?: string[];
}

export function TransactionsPage(props: TransactionsPageProps): Html {
  const {
    codi,
    page,
    groups,
    accountList,
    filters,
    potEditar,
    etiquetesConegudes = [],
    targetesConegudes = [],
  } = props;
  // El que et descarregues es el que estas veient: els mateixos filtres.
  const query = transactionFiltersToQuery(filters);
  const searchOberta = hasActiveFilters(filters);

  return html`
    <div class="moviments-pagina">
      <input
        type="checkbox"
        id="cerca-oberta"
        class="toggle-cerca visualment-ocult"
        ${searchOberta ? raw("checked") : ""}
      />
      <header class="capçalera capçalera-fila">
        <h1>Moviments</h1>
        <div class="capçalera-accions">
          <a class="boto boto-discret" href="/e/${codi}/moviments/moviments.csv${query}">
            Descarrega en CSV
          </a>
          <label for="cerca-oberta" class="boto boto-discret">Cerca</label>
        </div>
      </header>

      ${FilterBar({ codi, filters, accountList, groups, etiquetesConegudes, targetesConegudes })}
      ${Table({ codi, page, groups, filters, potEditar, etiquetesConegudes })}
    </div>
  ` as Html;
}

export interface ReviewPageProps {
  codi: string;
  items: ReviewItem[];
  groups: CategoryGroup[];
  total: number;
}

export function ReviewPage({ codi, items, groups, total }: ReviewPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Per revisar</h1>
      <p class="text-suau">
        El model local no confirma res pel seu compte: proposa una categoria i
        aqui la confirmes tu. El que confirmis es recorda per a tot el comerç
        d'aquest espai.
      </p>
    </header>

    ${ReviewQueue({ codi, items, groups, total })}
  ` as Html;
}
