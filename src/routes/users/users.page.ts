/**
 * Users page.
 */

import { html } from "hono/html";

import type { Ledger } from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";
import { CreateForm, List, type UserView } from "./users.fragment.ts";

export interface UsersPageProps {
  userList: UserView[];
  workspaces: Ledger[];
  me: number;
}

export function UsersPage({ userList, workspaces, me }: UsersPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>Usuaris</h1>
      <p class="text-suau">
        Qui entra a la instal·lacio i a quins espais. L'acces als espais es dona
        un per un: ser administrador no en dona cap.
      </p>
    </header>

    ${CreateForm({})} ${List({ userList, workspaces, me })}
  ` as Html;
}
