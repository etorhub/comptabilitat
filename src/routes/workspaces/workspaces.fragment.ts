/**
 * Fragments of the workspace configuration.
 */

import { html, raw } from "hono/html";

import { Field, FormError, type FieldErrors } from "../../components/form.ts";
import { LEDGER_ROLES, type Ledger, type LedgerRole } from "../../db/schema/index.ts";
import { DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";

const NAMES_ROL: Record<LedgerRole, string> = {
  viewer: "Pot mirar",
  editor: "Pot classificar",
  admin: "Pot configurar",
};

export interface MemberView {
  userId: number;
  email: string;
  fullName: string;
  role: LedgerRole;
}

export interface WorkspaceFormProps {
  workspace: Ledger;
  errors?: FieldErrors | undefined;
  fet?: boolean;
}

export function WorkspaceForm({ workspace, errors, fet = false }: WorkspaceFormProps): Html {
  return html`<form
    id="form-espai"
    class="superficie targeta"
    hx-post="/e/${workspace.code}/configuracio"
    hx-target="#form-espai"
    hx-swap="outerHTML"
  >
    <h2>Aquest espai</h2>
    ${fet ? html`<p class="form-ok" role="status">S'ha desat.</p>` : ""} ${FormError(errors)}

    <div class="form-linia">
      ${Field({ name: "name", tag: "Nom", value: workspace.name, errors, requerit: true })}
      ${Field({ name: "color", tag: "Color", type: "color", value: workspace.color, errors })}
    </div>

    ${Field({
      name: "description",
      tag: "Descripcio",
      value: workspace.description,
      errors,
    })}
    ${Field({
      name: "overdraft_threshold",
      tag: "Llindar de descobert",
      value: workspace.overdraftThreshold,
      errors,
      help: "Per sota d'aquest saldo previst salta l'avis. Si el compte te linia de credit, hi va el numero negatiu que correspongui.",
    })}
    ${Field({
      name: "alert_recipients",
      tag: "Destinataris dels avisos",
      value: workspace.alertRecipients.join(", "),
      errors,
      help: "Separats per comes. Si es buit, els avisos d'aquest espai van als destinataris generals.",
    })}

    <div class="form-accions">
      <button type="submit" class="boto">Desa</button>
    </div>
  </form>` as Html;
}

export function MembersTable({ members }: { members: MemberView[] }): Html {
  return html`<section class="superficie targeta">
    <h2>Qui hi entra</h2>
    <p class="text-suau nota">
      L'acces es dona des de <a href="/usuaris">Usuaris</a>, que es on hi ha
      tots els espais alhora.
    </p>
    ${DataTable({
      columnes: html`<th>Persona</th>
        <th>Acces</th>` as Html,
      rows: members.map(
        (m) =>
          html`<tr>
            <td>
              <span class="nom">${m.fullName || m.email}</span><br />
              <small class="text-suau">${m.email}</small>
            </td>
            <td>${NAMES_ROL[m.role]}</td>
          </tr>` as Html,
      ),
      empty: "Encara no hi entra ningu mes.",
    })}
  </section>` as Html;
}

/** The roles, in case one day they can be changed from here. */
export const AVAILABLE_ROLES = LEDGER_ROLES;
export { raw };
