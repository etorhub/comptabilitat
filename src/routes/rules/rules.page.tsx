/**
 * Pagina de regles.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import { FormAlta, Llista, type ReglaVista } from "./rules.fragment.tsx";

export interface RulesPageProps {
  codi: string;
  regles: ReglaVista[];
  grups: GrupCategories[];
  potEditar: boolean;
}

export function RulesPage({ codi, regles, grups, potEditar }: RulesPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Regles</h1>
      <p class="text-suau">
        S'apliquen per prioritat i la primera que encaixa guanya. Van abans que
        la memoria de comerços, pero mai per sobre del que hagis classificat tu.
      </p>
    </header>

    ${potEditar ? FormAlta({ codi, grups }) : ""}
    ${Llista({ codi, regles, potEditar })}
  ` as Html;
}
