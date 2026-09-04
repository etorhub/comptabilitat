/**
 * Fragments dels usuaris.
 */

import { html, raw } from "hono/html";

import { Camp, Casella, ErrorGeneral, type FieldErrors } from "../../components/form.tsx";
import {
  LEDGER_ROLES,
  type Ledger,
  type LedgerRole,
  type User,
} from "../../db/schema/index.ts";
import type { Html } from "../../lib/html.ts";

const NOMS_ROL: Record<LedgerRole, string> = {
  viewer: "Pot mirar",
  editor: "Pot classificar",
  admin: "Pot configurar",
};

export interface UsuariVista extends User {
  /** Espais on te acces, amb el rol. */
  accessos: { ledgerId: number; code: string; name: string; role: LedgerRole }[];
}

export interface LlistaProps {
  usuaris: UsuariVista[];
  espais: Ledger[];
  jo: number;
  oob?: boolean;
}

export function Llista({ usuaris, espais, jo, oob = false }: LlistaProps): Html {
  return html`<div id="llista-usuaris" ${oob ? raw('hx-swap-oob="true"') : ""}>
    ${usuaris.map((usuari) => Targeta({ usuari, espais, jo }))}
  </div>` as Html;
}

export interface TargetaProps {
  usuari: UsuariVista;
  espais: Ledger[];
  jo: number;
  /** Errors del formulari de nom / administrador. */
  editErrors?: FieldErrors | undefined;
  /** Errors del formulari de reiniciar la contrasenya. */
  passwordErrors?: FieldErrors | undefined;
}

export function Targeta({
  usuari,
  espais,
  jo,
  editErrors,
  passwordErrors,
}: TargetaProps): Html {
  const base = `/usuaris/${usuari.id}`;
  const soc = usuari.id === jo;
  const idPrefix = `u${usuari.id}`;

  return html`<section id="usuari-${usuari.id}" class="superficie targeta">
    <div class="item-cap">
      <strong>${usuari.fullName || usuari.email}</strong>
      <span class="text-suau">${usuari.email}</span>
      ${
        usuari.isAdmin
          ? html`<span class="etiqueta" title="Gestiona bancs i usuaris">administrador</span>`
          : ""
      }
      ${usuari.isActive ? "" : html`<span class="etiqueta etiqueta-suau">desactivat</span>`}
    </div>

    <p class="text-suau nota">
      Ser administrador de la instal·lacio <strong>no</strong> dona acces a cap
      espai: es concedeix un per un aqui sota.
    </p>

    <form
      hx-post="${base}"
      hx-target="#usuari-${usuari.id}"
      hx-swap="outerHTML"
      class="form-edicio"
    >
      ${ErrorGeneral(editErrors)}
      <div class="form-linia">
        ${Camp({
          nom: "full_name",
          id: `${idPrefix}-full_name`,
          etiqueta: "Nom",
          valor: usuari.fullName,
          errors: editErrors,
          autocomplete: "off",
        })}
      </div>
      ${Casella({
        nom: "is_admin",
        etiqueta: "Administrador de la instal·lacio (bancs i usuaris)",
        marcat: usuari.isAdmin,
        atributs: soc ? 'title="No et pots treure a tu mateix l\'admin"' : "",
      })}
      <div class="form-accions">
        <button type="submit" class="boto boto-discret">Desa</button>
      </div>
    </form>

    <div class="desplaçable">
      <table class="dades">
        <thead>
          <tr>
            <th>Espai</th>
            <th>Acces</th>
          </tr>
        </thead>
        <tbody>
          ${espais.map((espai) => {
            const acces = usuari.accessos.find((a) => a.ledgerId === espai.id);
            return html`<tr>
              <td>${espai.name}</td>
              <td>
                <form
                  hx-post="${base}/acces"
                  hx-target="#usuari-${usuari.id}"
                  hx-swap="outerHTML"
                  hx-trigger="change"
                >
                  <input type="hidden" name="ledger_id" value="${espai.id}" />
                  <select name="role" aria-label="Acces de ${usuari.email} a ${espai.name}">
                    <option value="" ${acces ? "" : raw("selected")}>— cap acces —</option>
                    ${LEDGER_ROLES.map(
                      (rol) =>
                        html`<option value="${rol}" ${acces?.role === rol ? raw("selected") : ""}>
                          ${NOMS_ROL[rol]}
                        </option>`,
                    )}
                  </select>
                </form>
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>

    <form
      hx-post="${base}/contrasenya"
      hx-target="#usuari-${usuari.id}"
      hx-swap="outerHTML"
      class="form-edicio"
    >
      <h3 class="menu-titol">Reinicia la contrasenya</h3>
      ${ErrorGeneral(passwordErrors)}
      <div class="form-linia">
        ${Camp({
          nom: "password",
          id: `${idPrefix}-password`,
          etiqueta: "Contrasenya nova",
          tipus: "password",
          errors: passwordErrors,
          requerit: true,
          autocomplete: "new-password",
          ajuda: "Com a minim 10 carácters. Li tanca totes les sessions obertes.",
        })}
      </div>
      <div class="form-accions">
        <button type="submit" class="boto boto-discret">Reinicia</button>
      </div>
    </form>

    <div class="form-accions">
      <form hx-post="${base}/estat" hx-target="#usuari-${usuari.id}" hx-swap="outerHTML">
        <button
          type="submit"
          class="boto boto-discret"
          ${soc ? raw("disabled title='No et pots desactivar tu mateix'") : ""}
        >
          ${usuari.isActive ? "Desactiva'l" : "Activa'l"}
        </button>
      </form>
    </div>
  </section>` as Html;
}

export interface FormAltaProps {
  errors?: FieldErrors | undefined;
  valors?: { email?: string; full_name?: string } | undefined;
}

export function FormAlta({ errors, valors }: FormAltaProps): Html {
  return html`<form
    id="form-usuari"
    class="superficie targeta"
    hx-post="/usuaris"
    hx-target="#form-usuari"
    hx-swap="outerHTML"
  >
    <h2>Afegeix un usuari</h2>
    ${ErrorGeneral(errors)}

    <div class="form-linia">
      ${Camp({
        nom: "email",
        etiqueta: "Correu",
        tipus: "email",
        valor: valors?.email ?? "",
        errors,
        requerit: true,
        autocomplete: "off",
      })}
      ${Camp({
        nom: "full_name",
        etiqueta: "Nom",
        valor: valors?.full_name ?? "",
        errors,
        autocomplete: "off",
      })}
      ${Camp({
        nom: "password",
        etiqueta: "Contrasenya",
        tipus: "password",
        errors,
        requerit: true,
        autocomplete: "new-password",
        ajuda: "Com a minim 10 carácters.",
      })}
    </div>

    <label class="casella">
      <input type="checkbox" name="is_admin" />
      <span>Administrador de la instal·lacio (bancs i usuaris)</span>
    </label>

    <div class="form-accions">
      <button type="submit" class="boto">Crea'l</button>
    </div>
  </form>` as Html;
}
