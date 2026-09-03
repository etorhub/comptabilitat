/**
 * Pagina de moviments.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { PaginaMoviments } from "../../services/transactions.ts";
import { BarraFiltres, Taula } from "./transactions.fragment.tsx";
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
