/**
 * Pagina d'usuaris.
 */

import { html } from "hono/html";

import type { Ledger } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { FormAlta, Llista, type UsuariVista } from "./users.fragment.tsx";

export interface UsersPageProps {
  usuaris: UsuariVista[];
  espais: Ledger[];
  jo: number;
}

export function UsersPage({ usuaris, espais, jo }: UsersPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Usuaris</h1>
      <p class="text-suau">
        Qui entra a la instal·lacio i a quins espais. L'acces als espais es dona
        un per un: ser administrador no en dona cap.
      </p>
    </header>

    ${FormAlta({})} ${Llista({ usuaris, espais, jo })}
  ` as Html;
}
