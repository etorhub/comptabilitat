/**
 * The bugs, as markup.
 *
 * Each fixture is a reduced version of what the application really rendered
 * before the named commit fixed it. They are here so every rule is tested
 * against the thing it claims to catch: a rule that passes its own bug is
 * decoration, and the only way to know is to keep the bug around.
 *
 * Reduced, not copied verbatim — the originals are hundreds of lines of table.
 * What is preserved is the shape that caused the failure.
 */

/**
 * e5dd962 — "Un error deixava de menjar-se la fila que estaves tocant".
 *
 * A 422 answered with nothing but an out-of-band toast. htmx lifted the toast
 * out, found an empty body, and swapped that emptiness into the row with
 * `outerHTML`. The row disappeared. It happened in thirteen places, the worst
 * being the server's own `onError` and the CSRF middleware, which fire on any
 * mutation with an expired session.
 */
export const TOAST_ONLY_422 = `<div hx-swap-oob="innerHTML:#toast"><div class="toast toast-error" role="alert"><strong>Error</strong><span>La categoria no existeix</span></div></div>`;

/** The same response done right: the header suppresses the main swap. */
export const TOAST_ONLY_422_FIXED_HEADERS = { "HX-Reswap": "none" };

/**
 * f5b8e9b — "La taula de moviments desava la categoria a la fila que no tocava".
 *
 * The bulk-selection `<form>` wrapped the whole table, and every row carried
 * its own `<select name="category_id">` inside it. htmx sends the enclosing
 * form's values on any non-GET request and lets them override the element's
 * own, so changing row 1 saved row 50's category. Every row also rendered
 * `id="category_id"`, which is invalid HTML and pointed every `aria-describedby`
 * at the first row.
 */
export const TABLE_WRAPPED_IN_FORM = `<form hx-post="/moviments/classifica">
  <table>
    <tbody>
      <tr id="moviment-1">
        <td><select id="category_id" name="category_id"><option value="1">Habitatge</option></select></td>
      </tr>
      <tr id="moviment-2">
        <td><select id="category_id" name="category_id"><option value="39">Altres</option></select></td>
      </tr>
    </tbody>
  </table>
</form>`;

/** The same table without the enclosing form: each row sends only its own value. */
export const TABLE_WITH_HX_INCLUDE = `<div id="taula-moviments">
  <table>
    <tbody>
      <tr id="moviment-1">
        <td><select id="categoria-1" name="category_id" hx-patch="/moviments/1" hx-target="#moviment-1" hx-swap="outerHTML"><option value="1">Habitatge</option></select></td>
      </tr>
      <tr id="moviment-2">
        <td><select id="categoria-2" name="category_id" hx-patch="/moviments/2" hx-target="#moviment-2" hx-swap="outerHTML"><option value="39">Altres</option></select></td>
      </tr>
    </tbody>
  </table>
</div>`;

/**
 * da64cb1 — "Les files i l'estat buit d'una llista, dibuixats al mateix lloc".
 *
 * Delete routes returned only the row, so removing the last item left a table
 * header standing over an empty body, with nothing anywhere saying the list had
 * ended. Rows and the empty state were written in separate branches, and
 * nothing obliged the delete path to respect the second one.
 */
export const LIST_WITH_ONE_ROW = `<div id="llista-regles">
  <table class="dades">
    <thead><tr><th>Regla</th></tr></thead>
    <tbody><tr id="regla-1"><td>L'unica</td></tr></tbody>
  </table>
</div>`;

/** What the delete route used to answer: the row, hidden. Nothing else. */
export const DELETE_ROW_ONLY = `<tr id="regla-1" hidden></tr>`;

/** What it answers now: the whole list, which is empty, and says so. */
export const DELETE_WHOLE_LIST = `<div id="llista-regles">
  <p class="buit">No hi ha cap regla.</p>
</div>`;

/**
 * f80df91 — "Una importacio interrompuda ja no deixa la pagina sondejant per
 * sempre".
 *
 * The fragment re-armed itself while the run was not in a terminal state. A
 * `docker compose stop` in the middle left the row `running` for ever, so the
 * page asked for it every two seconds, indefinitely, for everyone looking at
 * it.
 */
export const UNBOUNDED_POLL = `<div id="sync-4" hx-get="/connexions/4/fragment/sync" hx-target="#sync-4" hx-swap="outerHTML" hx-trigger="every 2s">Important…</div>`;

/** The same fragment declaring a bound. */
export const BOUNDED_POLL = `<div id="sync-4" hx-get="/connexions/4/fragment/sync?intent=8" hx-target="#sync-4" hx-swap="outerHTML" hx-trigger="every 2s" data-poll-max="900">Important…</div>`;

/** A minimal page to swap things into. */
export const PAGE = `<!doctype html>
<html lang="ca">
  <body>
    <div id="taula-moviments">
      <table>
        <tbody>
          <tr id="moviment-1"><td>Una fila</td></tr>
          <tr id="moviment-2"><td>Una altra</td></tr>
        </tbody>
      </table>
    </div>
    <div id="toast" aria-live="polite"></div>
    <span id="comptador-revisio"></span>
  </body>
</html>`;
