/**
 * Fragments de la configuracio de l'espai.
 */

import { html, raw } from "hono/html";

import { Camp, ErrorGeneral, type FieldErrors } from "../../components/form.tsx";
import { LEDGER_ROLES, type Ledger, type LedgerRole } from "../../db/schema/index.ts";
import { TaulaDades } from "../../components/vista.tsx";
import type { Html } from "../../lib/html.ts";

const NOMS_ROL: Record<LedgerRole, string> = {
  viewer: "Pot mirar",
  editor: "Pot classificar",
  admin: "Pot configurar",
};

export interface MembreVista {
  userId: number;
  email: string;
  fullName: string;
  role: LedgerRole;
}

export interface FormEspaiProps {
  espai: Ledger;
  errors?: FieldErrors | undefined;
  fet?: boolean;
}

export function FormEspai({ espai, errors, fet = false }: FormEspaiProps): Html {
  return html`<form
    id="form-espai"
    class="superficie targeta"
    hx-post="/e/${espai.code}/configuracio"
    hx-target="#form-espai"
    hx-swap="outerHTML"
  >
    <h2>Aquest espai</h2>
    ${fet ? html`<p class="form-ok" role="status">S'ha desat.</p>` : ""} ${ErrorGeneral(errors)}

    <div class="form-linia">
      ${Camp({ nom: "name", etiqueta: "Nom", valor: espai.name, errors, requerit: true })}
      ${Camp({ nom: "color", etiqueta: "Color", tipus: "color", valor: espai.color, errors })}
    </div>

    ${Camp({
      nom: "description",
      etiqueta: "Descripcio",
      valor: espai.description,
      errors,
    })}
    ${Camp({
      nom: "overdraft_threshold",
      etiqueta: "Llindar de descobert",
      valor: espai.overdraftThreshold,
      errors,
      ajuda:
        "Per sota d'aquest saldo previst salta l'avis. Si el compte te linia de credit, hi va el numero negatiu que correspongui.",
    })}
    ${Camp({
      nom: "alert_recipients",
      etiqueta: "Destinataris dels avisos",
      valor: espai.alertRecipients.join(", "),
      errors,
      ajuda:
        "Separats per comes. Si es buit, els avisos d'aquest espai van als destinataris generals.",
    })}

    <div class="form-accions">
      <button type="submit" class="boto">Desa</button>
    </div>
  </form>` as Html;
}

export function TaulaMembres({ membres }: { membres: MembreVista[] }): Html {
  return html`<section class="superficie targeta">
    <h2>Qui hi entra</h2>
    <p class="text-suau nota">
      L'acces es dona des de <a href="/usuaris">Usuaris</a>, que es on hi ha
      tots els espais alhora.
    </p>
    ${TaulaDades({
      columnes: html`<th>Persona</th>
        <th>Acces</th>` as Html,
      files: membres.map(
        (m) =>
          html`<tr>
            <td>
              <span class="nom">${m.fullName || m.email}</span><br />
              <small class="text-suau">${m.email}</small>
            </td>
            <td>${NOMS_ROL[m.role]}</td>
          </tr>` as Html,
      ),
      buit: "Encara no hi entra ningu mes.",
    })}
  </section>` as Html;
}

/** Els rols, per si algun dia es poden canviar des d'aqui. */
export const ROLS_DISPONIBLES = LEDGER_ROLES;
export { raw };
