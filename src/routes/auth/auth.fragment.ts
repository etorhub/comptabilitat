/**
 * Fragments d'autenticacio.
 *
 * El formulari d'entrada es l'unic de tota l'aplicacio que duu el camp ocult
 * `_csrf`: quan es dibuixa encara no hi ha sessio, i per tant tampoc no hi ha
 * el `hx-headers` del `<body>` que la resta hereten.
 *
 * A mes, s'envia com un formulari de tota la vida (`method="post"`), no per
 * HTMX: despres d'entrar cal una navegacio de debò, amb la galeta nova, i no
 * un intercanvi de tros de pagina.
 */

import { html, raw } from "hono/html";
import type { Html } from "../../lib/html.ts";

import { Field, FormError, type FieldErrors } from "../../components/form.ts";
import { CSRF_FIELD } from "../../lib/csrf.ts";

export interface LoginFormProps {
  /** Testimoni d'un sol us per al formulari d'entrada (vegeu `auth.routes.ts`). */
  csrfToken: string;
  desti?: string;
  email?: string;
  errors?: FieldErrors | undefined;
}

export function LoginForm(props: LoginFormProps): Html {
  const { csrfToken, desti = "/", email = "", errors } = props;

  return html`<form method="post" action="/entrada" class="form">
    <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
    <input type="hidden" name="desti" value="${desti}" />

    ${FormError(errors)}
    ${Field({
      name: "email",
      tag: "Correu",
      type: "email",
      valor: email,
      errors,
      requerit: true,
      autocomplete: "username",
      autofocus: true,
    })}
    ${Field({
      name: "password",
      tag: "Contrasenya",
      type: "password",
      errors,
      requerit: true,
      autocomplete: "current-password",
    })}

    <button type="submit" class="boto">Entra</button>
  </form>` as Html;
}

export interface PasswordFormProps {
  errors?: FieldErrors | undefined;
  fet?: boolean;
}

/**
 * Formulari de canvi de contrasenya. Aquest si que va per HTMX: es queda a la
 * mateixa pagina i es torna a dibuixar amb els errors o amb la confirmacio.
 */
export function PasswordForm(props: PasswordFormProps): Html {
  const { errors, fet = false } = props;

  return html`<form
    id="form-contrasenya"
    class="form"
    hx-post="/contrasenya"
    hx-target="#form-contrasenya"
    hx-swap="outerHTML"
  >
    ${
      fet
        ? html`<p class="form-ok" role="status">
          La contrasenya s'ha canviat. Les altres sessions s'han tancat.
        </p>`
        : ""
    }
    ${FormError(errors)}
    ${Field({
      name: "current_password",
      tag: "Contrasenya actual",
      type: "password",
      errors,
      requerit: true,
      autocomplete: "current-password",
    })}
    ${Field({
      name: "new_password",
      tag: "Contrasenya nova",
      type: "password",
      errors,
      requerit: true,
      autocomplete: "new-password",
      help: "Com a minim 10 carácters.",
    })}
    ${Field({
      name: "confirm_password",
      tag: "Repeteix la contrasenya nova",
      type: "password",
      errors,
      requerit: true,
      autocomplete: "new-password",
    })}

    <button type="submit" class="boto">Canvia-la</button>
  </form>` as Html;
}
