/**
 * Pages of the tags resource.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { CategoryGroup } from "../../services/categories.ts";
import type { TagSummary } from "../../services/tags.ts";
import type { TransactionsPage } from "../../services/transactions.ts";
import { CapAleraDetail, TagsList, DetailTable } from "./tags.fragment.ts";
import type { TagDetailQuery } from "./tags.schema.ts";

export function TagsPage({
  code,
  tags,
  canEdit,
}: {
  code: string;
  tags: TagSummary[];
  canEdit: boolean;
}): Html {
  return html`
    <header class="capçalera">
      <h1>Etiquetes</h1>
      <p class="text-suau">
        Conceptes transversals (casament, projecteX…) mes enlla de les
        categories. S'afegeixen des dels moviments.
      </p>
    </header>

    ${TagsList({ code, tags, canEdit })}
  ` as Html;
}

export function TagDetailPage({
  code,
  summary,
  page,
  groups,
  canEdit,
  query,
  knownTags,
}: {
  code: string;
  summary: TagSummary;
  page: TransactionsPage;
  groups: CategoryGroup[];
  canEdit: boolean;
  query: TagDetailQuery;
  knownTags: string[];
}): Html {
  return html`
    ${CapAleraDetail({ code, summary, canEdit })}
    ${DetailTable({
      code,
      name: summary.name,
      page,
      groups,
      canEdit,
      query,
      knownTags,
    })}
  ` as Html;
}
