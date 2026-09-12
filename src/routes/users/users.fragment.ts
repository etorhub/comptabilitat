/**
 * Fragments dels usuaris.
 */

import { html, raw } from "hono/html";

import { Field, Checkbox, FormError, type FieldErrors } from "../../components/form.ts";
import {
  LEDGER_ROLES,
  type Ledger,
  type LedgerRole,
  type User,
} from "../../db/schema/index.ts";
import { DataTable } from "../../components/vista.ts";
import type { Html } from "../../lib/html.ts";
import { oobAttributes } from "../../lib/oob.ts";

const NAMES_ROL: Record<LedgerRole, string> = {
  viewer: "Pot mirar",
  editor: "Pot classificar",
  admin: "Pot configurar",
};

export interface UserView extends User {
  /** Espais on te acces, amb el rol. */
  accessos: { ledgerId: number; code: string; name: string; role: LedgerRole }[];
}

export interface ListProps {
  userList: UserView[];
  workspaces: Ledger[];
  jo: number;
  oob?: boolean;
}

export function List({ userList, workspaces, jo, oob = false }: ListProps): Html {
  return html`<div ${oobAttributes("llista-usuaris", oob)}>
    ${userList.map((user) => Card({ user, workspaces, jo }))}
  </div>` as Html;
}

export interface CardProps {
  user: UserView;
  workspaces: Ledger[];
  jo: number;
  /** Errors del formulari de nom / administrador. */
  editErrors?: FieldErrors | undefined;
  /** Errors del formulari de reiniciar la contrasenya. */
  passwordErrors?: FieldErrors | undefined;
}

export function Card({ user, workspaces, jo, editErrors, passwordErrors }: CardProps): Html {
  const base = `/usuaris/${user.id}`;
  const soc = user.id === jo;
  const idPrefix = `u${user.id}`;

  return html`<section id="usuari-${user.id}" class="superficie targeta">
    <div class="item-cap">
      <strong>${user.fullName || user.email}</strong>
      <span class="text-suau">${user.email}</span>
      ${
        user.isAdmin
          ? html`<span class="etiqueta" title="Gestiona bancs i usuaris">administrador</span>`
          : ""
      }
      ${user.isActive ? "" : html`<span class="etiqueta etiqueta-suau">desactivat</span>`}
    </div>

    <p class="text-suau nota">
      Ser administrador de la instal·lacio <strong>no</strong> dona acces a cap
      espai: es concedeix un per un aqui sota.
    </p>

    <form
      hx-post="${base}"
      hx-target="#usuari-${user.id}"
      hx-swap="outerHTML"
      class="form-edicio"
    >
      ${FormError(editErrors)}
      <div class="form-linia">
        ${Field({
          name: "full_name",
          id: `${idPrefix}-full_name`,
          tag: "Nom",
          value: user.fullName,
          errors: editErrors,
          autocomplete: "off",
        })}
      </div>
      ${Checkbox({
        name: "is_admin",
        tag: "Administrador de la instal·lacio (bancs i usuaris)",
        marcat: user.isAdmin,
        attributes: soc ? 'title="No et pots treure a tu mateix l\'admin"' : "",
      })}
      <div class="form-accions">
        <button type="submit" class="boto boto-discret">Desa</button>
      </div>
    </form>

    ${DataTable({
      columnes: html`<th>Espai</th>
        <th>Acces</th>` as Html,
      empty: "Encara no hi ha cap espai actiu.",
      rows: workspaces.map((workspace) => {
        const access = user.accessos.find((a) => a.ledgerId === workspace.id);
        return html`<tr>
              <td>${workspace.name}</td>
              <td>
                <form
                  hx-post="${base}/acces"
                  hx-target="#usuari-${user.id}"
                  hx-swap="outerHTML"
                  hx-trigger="change"
                >
                  <input type="hidden" name="ledger_id" value="${workspace.id}" />
                  <select name="role" aria-label="Acces de ${user.email} a ${workspace.name}">
                    <option value="" ${access ? "" : raw("selected")}>— cap acces —</option>
                    ${LEDGER_ROLES.map(
                      (rol) =>
                        html`<option value="${rol}" ${access?.role === rol ? raw("selected") : ""}>
                          ${NAMES_ROL[rol]}
                        </option>`,
                    )}
                  </select>
                </form>
              </td>
            </tr>` as Html;
      }),
    })}

    <form
      hx-post="${base}/contrasenya"
      hx-target="#usuari-${user.id}"
      hx-swap="outerHTML"
      class="form-edicio"
    >
      <h3 class="menu-titol">Reinicia la contrasenya</h3>
      ${FormError(passwordErrors)}
      <div class="form-linia">
        ${Field({
          name: "password",
          id: `${idPrefix}-password`,
          tag: "Contrasenya nova",
          type: "password",
          errors: passwordErrors,
          requerit: true,
          autocomplete: "new-password",
          help: "Com a minim 10 carácters. Li tanca totes les sessions obertes.",
        })}
      </div>
      <div class="form-accions">
        <button type="submit" class="boto boto-discret">Reinicia</button>
      </div>
    </form>

    <div class="form-accions">
      <form hx-post="${base}/estat" hx-target="#usuari-${user.id}" hx-swap="outerHTML">
        <button
          type="submit"
          class="boto boto-discret"
          ${soc ? raw("disabled title='No et pots desactivar tu mateix'") : ""}
        >
          ${user.isActive ? "Desactiva'l" : "Activa'l"}
        </button>
      </form>
    </div>
  </section>` as Html;
}

export interface CreateFormProps {
  errors?: FieldErrors | undefined;
  values?: { email?: string; full_name?: string } | undefined;
}

export function CreateForm({ errors, values }: CreateFormProps): Html {
  return html`<form
    id="form-usuari"
    class="superficie targeta"
    hx-post="/usuaris"
    hx-target="#form-usuari"
    hx-swap="outerHTML"
  >
    <h2>Afegeix un usuari</h2>
    ${FormError(errors)}

    <div class="form-linia">
      ${Field({
        name: "email",
        tag: "Correu",
        type: "email",
        value: values?.email ?? "",
        errors,
        requerit: true,
        autocomplete: "off",
      })}
      ${Field({
        name: "full_name",
        tag: "Nom",
        value: values?.full_name ?? "",
        errors,
        autocomplete: "off",
      })}
      ${Field({
        name: "password",
        tag: "Contrasenya",
        type: "password",
        errors,
        requerit: true,
        autocomplete: "new-password",
        help: "Com a minim 10 carácters.",
      })}
    </div>

    ${Checkbox({
      name: "is_admin",
      tag: "Administrador de la instal·lacio (bancs i usuaris)",
    })}

    <div class="form-accions">
      <button type="submit" class="boto">Crea'l</button>
    </div>
  </form>` as Html;
}
