/**
 * Pagina de comerços.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { PaginaComercos } from "../../services/merchants.ts";
import { BarraFiltres, Taula } from "./merchants.fragment.tsx";
import type { MerchantFilters } from "./merchants.schema.ts";

export interface MerchantsPageProps {
  codi: string;
  pagina: PaginaComercos;
  grups: GrupCategories[];
  filters: MerchantFilters;
  potEditar: boolean;
}

export function MerchantsPage(props: MerchantsPageProps): Html {
  const { codi, pagina, grups, filters, potEditar } = props;

  return html`
    <header class="capçalera">
      <h1>Comerços</h1>
      <p class="text-suau">
        La memoria d'aquest espai. Quan hi poses la categoria d'un comerç, es
        recorda per a tots els seus moviments; els que hagis classificat tu a ma
        no es toquen mai.
      </p>
    </header>

    ${BarraFiltres({ codi, filters })}
    ${Taula({ codi, pagina, grups, filters, potEditar })}
  ` as Html;
}
