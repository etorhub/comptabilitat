/**
 * Pagines del recurs d'etiquetes.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type { TagSummary } from "../../services/tags.ts";
import type { TransactionsPage } from "../../services/transactions.ts";
import { CapAleraDetail, TagsList, DetailTable } from "./tags.fragment.ts";
import type { TagDetailQuery } from "./tags.schema.ts";

export function TagsPage({
  codi,
  tags,
  potEditar,
}: {
  codi: string;
  tags: TagSummary[];
  potEditar: boolean;
}): Html {
  return html`
    <header class="capçalera">
      <h1>Etiquetes</h1>
      <p class="text-suau">
        Conceptes transversals (casament, projecteX…) mes enlla de les
        categories. S'afegeixen des dels moviments.
      </p>
    </header>

    ${TagsList({ codi, tags, potEditar })}
  ` as Html;
}

export function TagDetailPage({
  codi,
  summary,
  page,
  groups,
  potEditar,
  query,
  etiquetesConegudes,
}: {
  codi: string;
  summary: TagSummary;
  page: TransactionsPage;
  groups: CategoryGroup[];
  potEditar: boolean;
  query: TagDetailQuery;
  etiquetesConegudes: string[];
}): Html {
  return html`
    ${CapAleraDetail({ codi, summary, potEditar })}
    ${DetailTable({
      codi,
      name: summary.name,
      page,
      groups,
      potEditar,
      query,
      etiquetesConegudes,
    })}
  ` as Html;
}
