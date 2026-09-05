/**
 * Pagina d'actors.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { PaginaActors } from "../../services/actors.ts";
import { BarraFiltres, Taula } from "./actors.fragment.tsx";
import type { ActorFilters } from "./actors.schema.ts";

export interface ActorsPageProps {
  codi: string;
  pagina: PaginaActors;
  usuaris: { id: number; fullName: string }[];
  tots: { id: number; displayName: string }[];
  filters: ActorFilters;
  potEditar: boolean;
}

export function ActorsPage(props: ActorsPageProps): Html {
  const { codi, pagina, usuaris, tots, filters, potEditar } = props;

  return html`
    <header class="capçalera">
      <h1>Actors</h1>
      <p class="text-suau">
        Qui hi ha a l'altra banda d'una transferencia. A diferencia d'un
        comerç, un actor no classifica mai res: cada transferencia queda
        pendent de revisar. Lligar-lo a un usuari de l'app permet
        identificar-lo i reconeixer els seus moviments entre espais.
      </p>
    </header>

    ${BarraFiltres({ codi, filters })}
    ${Taula({ codi, pagina, usuaris, tots, filters, potEditar })}
  ` as Html;
}
