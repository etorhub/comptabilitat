/**
 * Sign-in and password change pages.
 */

import { html } from "hono/html";
import type { Html } from "../../lib/html.ts";

import { Shell } from "../../components/shell.ts";
import { LoginForm, type LoginFormProps } from "./auth.fragment.ts";

export function LoginPage(props: LoginFormProps): Html {
  return Shell({
    title: "Entra",
    children: html`
      <h1>Comptabilitat</h1>
      <p class="text-suau">Entra per veure els teus espais.</p>
      ${LoginForm(props)}
    `,
  });
}

export interface PasswordPageProps {
  children: unknown;
}

export function PasswordPage(props: PasswordPageProps): Html {
  return html`
    <header class="capçalera">
      <h1>La teva contrasenya</h1>
      <p class="text-suau">
        Canviar-la tanca la resta de sessions obertes, aqui i a qualsevol altre
        aparell.
      </p>
    </header>
    <section class="superficie targeta">${props.children}</section>
  ` as Html;
}
