/**
 * Authentication fragments.
 *
 * The sign-in form is the only one in the whole application that carries the
 * hidden `_csrf` field: when it is drawn there is no session yet, and
 * therefore neither is the `hx-headers` of the `<body>` the rest inherit.
 *
 * On top of that it is submitted as an ordinary form (`method="post"`), not
 * over HTMX: after signing in a real navigation is needed, with the new
 * cookie, and not a swap of a piece of the page.
 */

import { html, raw } from "hono/html";
import type { Html } from "../../lib/html.ts";

import { Field, FormError, type FieldErrors } from "../../components/form.ts";
import { CSRF_FIELD } from "../../lib/csrf.ts";

export interface LoginFormProps {
  /** Single-use token for the sign-in form (see `auth.routes.ts`). */
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
      value: email,
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
 * Password change form. This one does go over HTMX: it stays on the same page
 * and is redrawn with the errors or with the confirmation.
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
