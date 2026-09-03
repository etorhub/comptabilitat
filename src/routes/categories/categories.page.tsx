/**
 * Pagina de categories.
 */

import { html } from "hono/html";

import type { CategoryKind } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import type { GrupCategories, NodeCategoria } from "../../services/categories.ts";
import { Arbre, FormAlta } from "./categories.fragment.tsx";

export interface CategoriesPageProps {
  codi: string;
  arbre: Record<CategoryKind, NodeCategoria[]>;
  grups: GrupCategories[];
  potEditar: boolean;
}

export function CategoriesPage({ codi, arbre, grups, potEditar }: CategoriesPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Categories</h1>
      <p class="text-suau">
        El pla de comptes d'aquest espai. Nomes te dos nivells, i no el
        comparteix amb cap altre espai.
      </p>
    </header>

    ${potEditar ? FormAlta({ codi, grups }) : ""}
    ${Arbre({ codi, arbre, potEditar })}
  ` as Html;
}
