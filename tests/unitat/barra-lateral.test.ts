/**
 * The sidebar and the `#toast`.
 *
 * Two things the stylesheet knew how to draw and no template ever asked for:
 *
 *   - `.menu a[aria-current="page"]` had its background from day one and
 *     nobody wrote the attribute: the bar did not say where you were,
 *     neither in color nor to a screen reader.
 *   - The `#toast` was born with `aria-live="polite"` and the first toast
 *     replaced it with a `<div id="toast">` without the attribute, so that
 *     from then on there was no live region at all. Now the `#toast`'s
 *     **content** is changed and the container never moves.
 */

import { describe, expect, test } from "bun:test";

import { Layout } from "../../src/components/layout.ts";
import { clearToast, toast } from "../../src/lib/http.ts";
import type { Ledger, LedgerRole, User } from "../../src/db/schema/index.ts";

const user = {
  id: 1,
  email: "algu@exemple.cat",
  fullName: "Algu",
  isAdmin: true,
  isActive: true,
} as User;

const workspace = { id: 7, code: "personal", name: "Personal" } as Ledger;
const workspaces = [
  { ...workspace, role: "owner" as LedgerRole } as Ledger & { role: LedgerRole },
];

async function bar(path: string): Promise<string> {
  return String(
    await Layout({
      title: "Prova",
      user: user,
      csrfToken: "x",
      workspaces,
      workspace,
      path,
      children: "",
    }),
  );
}

/** The `href` of the link marked as the current page. */
function marcat(page: string): string[] {
  return [...page.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1] ?? "");
}

describe("aria-current in the sidebar", () => {
  test("marks the page being viewed, and only one", async () => {
    expect(marcat(await bar("/e/personal/moviments"))).toEqual(["/e/personal/moviments"]);
    // And those of the configuration group, which the master moved aside.
    expect(marcat(await bar("/e/personal/etiquetes"))).toEqual(["/e/personal/etiquetes"]);
    expect(marcat(await bar("/e/personal/categories"))).toEqual(["/e/personal/categories"]);
  });

  test("the longest path wins, not the first that matches", async () => {
    // «Panell» is `/e/personal`, which is the start of all the others.
    expect(marcat(await bar("/e/personal/avisos"))).toEqual(["/e/personal/avisos"]);
    // And «Moviments» is the start of «Per revisar».
    expect(marcat(await bar("/e/personal/moviments/revisio"))).toEqual([
      "/e/personal/moviments/revisio",
    ]);
    // The dashboard, on its own page, is marked.
    expect(marcat(await bar("/e/personal"))).toEqual(["/e/personal"]);
  });

  test("also on the administration screens", async () => {
    expect(marcat(await bar("/usuaris"))).toEqual(["/usuaris"]);
    expect(marcat(await bar("/connexions"))).toEqual(["/connexions"]);
    expect(marcat(await bar("/feines"))).toEqual(["/feines"]);
  });

  test("a URL belonging to no link marks none", async () => {
    expect(marcat(await bar("/contrasenya"))).toEqual([]);
  });

  test("any page is born with the live region", async () => {
    expect(await bar("/e/personal")).toContain('<div id="toast" aria-live="polite">');
  });
});

/**
 * The mobile drawer.
 *
 * It is pure CSS: a hidden checkbox and some `<label>`s pointing at it. If
 * somebody changes the id on one side and not the other, the menu stops
 * opening and nothing breaks —the browser does not complain about a `for`
 * pointing nowhere—, so what is checked here is that both sides say the same.
 */
describe("the navigation drawer", () => {
  test("the checkbox and every `for` pointing at it have the same name", async () => {
    const page = await bar("/e/personal");

    expect(page).toContain('<input type="checkbox" id="menu-obert"');
    // The open one, the backdrop and the close one.
    expect([...page.matchAll(/for="menu-obert"/g)]).toHaveLength(3);
  });

  test("the drawer's buttons say what they do", async () => {
    const page = await bar("/e/personal");

    // They are `<label>`s with an icon inside: without this they say nothing.
    expect(page).toContain('aria-label="Obre el menu"');
    expect(page).toContain('aria-label="Tanca el menu"');
  });

  test("the counters are not duplicated in the top bar", async () => {
    // They are out-of-band targets and each id has a single owner: if they
    // were drawn twice, the swap would find only one and the other would be
    // left stuck with the old number. See AGENTS.md.
    const page = await bar("/e/personal");

    expect([...page.matchAll(/id="comptador-revisio"/g)]).toHaveLength(1);
    expect([...page.matchAll(/id="comptador-avisos"/g)]).toHaveLength(1);
  });

  test("the top bar says which workspace you are in", async () => {
    expect(await bar("/e/personal")).toContain(
      '<span class="barra-mobil-espai text-suau">Personal</span>',
    );
  });
});

describe("#toast", () => {
  test("changes the content and not the container", () => {
    // If you return a `<div id="toast">`, the live region goes with it.
    for (const node of [toast("Ha petat"), clearToast()]) {
      expect(String(node)).toContain('hx-swap-oob="innerHTML:#toast"');
      expect(String(node)).not.toContain('id="toast"');
    }
  });

  test("an error interrupts; a confirmation waits its turn", () => {
    expect(String(toast("Ha petat", "error"))).toContain('role="alert"');
    expect(String(toast("Fet", "success"))).toContain('role="status"');
    expect(String(toast("Compte", "info"))).toContain('role="status"');
  });

  test("the message is escaped", () => {
    expect(String(toast("<img src=x onerror=alert(1)>"))).not.toContain("<img");
  });
});
