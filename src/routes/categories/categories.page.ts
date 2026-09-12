/**
 * Pagina de categories.
 */

import { html } from "hono/html";

import type { CategoryKind } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import type { CategoryGroup, NodeCategory } from "../../services/categories.ts";
import { Tree, CreateForm } from "./categories.fragment.ts";

export interface CategoriesPageProps {
  code: string;
  tree: Record<CategoryKind, NodeCategory[]>;
  groups: CategoryGroup[];
  canEdit: boolean;
}

export function CategoriesPage({ code, tree, groups, canEdit }: CategoriesPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Categories</h1>
      <p class="text-suau">
        El pla de comptes d'aquest espai. Nomes te dos nivells, i no el
        comparteix amb cap altre espai.
      </p>
    </header>

    ${canEdit ? CreateForm({ code, groups }) : ""}
    ${Tree({ code, tree, canEdit })}
  ` as Html;
}
