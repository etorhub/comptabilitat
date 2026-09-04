/**
 * Pagines del recurs d'etiquetes.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { GrupCategories } from "../../services/categories.ts";
import type { ResumEtiqueta } from "../../services/tags.ts";
import type { PaginaMoviments } from "../../services/transactions.ts";
import { CapçaleraDetall, LlistaEtiquetes, TaulaDetall } from "./tags.fragment.tsx";
import type { TagDetailQuery } from "./tags.schema.ts";

export function TagsPage({
  codi,
  etiquetes,
  potEditar,
}: {
  codi: string;
  etiquetes: ResumEtiqueta[];
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

    ${LlistaEtiquetes({ codi, etiquetes, potEditar })}
  ` as Html;
}

export function TagDetailPage({
  codi,
  resum,
  pagina,
  grups,
  potEditar,
  query,
  etiquetesConegudes,
}: {
  codi: string;
  resum: ResumEtiqueta;
  pagina: PaginaMoviments;
  grups: GrupCategories[];
  potEditar: boolean;
  query: TagDetailQuery;
  etiquetesConegudes: string[];
}): Html {
  return html`
    ${CapçaleraDetall({ codi, resum, potEditar })}
    ${TaulaDetall({
      codi,
      nom: resum.nom,
      pagina,
      grups,
      potEditar,
      query,
      etiquetesConegudes,
    })}
  ` as Html;
}
