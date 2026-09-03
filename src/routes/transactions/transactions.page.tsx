/**
 * Pagina de moviments.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { ItemRevisio, PaginaMoviments } from "../../services/transactions.ts";
import { BarraFiltres, CuaRevisio, Taula } from "./transactions.fragment.tsx";
import type { TransactionFilters } from "./transactions.schema.ts";

export interface TransactionsPageProps {
  codi: string;
  pagina: PaginaMoviments;
  grups: GrupCategories[];
  comptes: { valor: number; text: string }[];
  filters: TransactionFilters;
  potEditar: boolean;
}

export function TransactionsPage(props: TransactionsPageProps): Html {
  const { codi, pagina, grups, comptes, filters, potEditar } = props;

  return html`
    <header class="capçalera">
      <h1>Moviments</h1>
      <p class="text-suau">
        Els traspassos entre comptes d'aquest espai no hi surten si no els
        demanes: no son ni ingres ni despesa.
      </p>
    </header>

    ${BarraFiltres({ codi, filters, comptes, grups })}
    ${Taula({ codi, pagina, grups, filters, potEditar })}
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
