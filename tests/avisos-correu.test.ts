/**
 * Email alerts.
 *
 * A port of `backend/tests/test_notifications.py`. The mail server is
 * simulated: no test touches anything outside.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { isNull } from "drizzle-orm";

interface SentMail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

const enviats: SentMail[] = [];
let serverCrashes = false;

mock.module("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: (options: SentMail) => {
        if (serverCrashes) throw new Error("servidor caigut");
        enviats.push(options);
        return Promise.resolve({ messageId: "1" });
      },
      close: () => undefined,
    }),
  },
}));

const { db } = await import("../src/db/client.ts");
const { alerts, ledgers } = await import("../src/db/schema/index.ts");
const { config } = await import("../src/lib/config.ts");
const { sendMail, renderSummary } = await import("../src/lib/email.ts");
const { notifyPending } = await import("../src/services/notify.ts");

import type { AlertSeverity } from "../src/db/schema/enums.ts";

/** The `config` is `as const` for the type, but the fields can be touched. */
const ajustos = config as {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  alertRecipients: string[];
};

function configureMail(): void {
  ajustos.smtpHost = "smtp.example.com";
  ajustos.smtpPort = 587;
  ajustos.smtpUser = "usuari";
  ajustos.smtpPassword = "secret";
  ajustos.smtpFrom = "comptes@example.com";
  ajustos.alertRecipients = ["etor@example.com"];
}

async function createAlert(
  title = "Possible descobert",
  severity: AlertSeverity = "warning",
  key = "a",
  ledgerId: number | null = null,
): Promise<void> {
  await db.insert(alerts).values({
    ledgerId,
    type: "projected_overdraft",
    severity,
    status: "new",
    dedupKey: key,
    title,
    body: "El saldo baixaria de zero el 12/09/2026.",
    payload: {},
  });
}

beforeEach(async () => {
  enviats.length = 0;
  serverCrashes = false;
  configureMail();
  await db.delete(alerts);
  await db.delete(ledgers);
});

describe("el resum", () => {
  test("inclou tots els avisos i l'adreça de l'aplicacio", async () => {
    const { html, text } = await renderSummary(
      [
        {
          severity: "warning",
          title: "Primer",
          body: "b",
          ledgerName: "",
          created: "01/01/2026",
        },
        { severity: "info", title: "Segon", body: "b", ledgerName: "", created: "01/01/2026" },
      ],
      "Resum",
      "Avisos nous",
    );

    expect(html).toContain("Primer");
    expect(html).toContain("Segon");
    expect(text).toContain("Primer");
    expect(text).toContain("Segon");
    expect(html).toContain(config.publicBaseUrl);
  });

  test("escapa el que ve del banc", async () => {
    const { html } = await renderSummary(
      [
        {
          severity: "info",
          title: "<script>alert(1)</script>",
          body: "",
          ledgerName: "",
          created: "",
        },
      ],
      "Resum",
      "",
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("l'enviament", () => {
  test("sense configuracio no s'envia res", async () => {
    ajustos.smtpHost = "";
    await createAlert();

    const result = await notifyPending();

    expect(result).toContain("no hi ha destinataris");
    const [alert] = await db.select().from(alerts);
    expect(alert?.notifiedAt).toBeNull();
  });

  test("els avisos s'envien i es marquen", async () => {
    await createAlert("Primer", "warning", "1");
    await createAlert("Segon", "warning", "2");

    const result = await notifyPending();

    expect(result).toContain("2 avisos enviats");
    expect(enviats.length).toBe(1);
    expect(enviats[0]?.to).toEqual(["etor@example.com"]);
    expect(enviats[0]?.subject).toContain("Resum d'avisos (2)");

    const withoutNotifying = await db.select().from(alerts).where(isNull(alerts.notifiedAt));
    expect(withoutNotifying.length).toBe(0);
  });

  test("no es repeteix l'enviament", async () => {
    await createAlert();
    await notifyPending();

    expect(await notifyPending()).toBe("Cap avis pendent d'enviar");
    expect(enviats.length).toBe(1);
  });

  test("el mode urgent nomes envia els critics", async () => {
    await createAlert("Normal", "warning", "1");
    await createAlert("Urgent", "critical", "2");

    const result = await notifyPending(true);

    expect(result).toContain("1 avisos enviats");
    expect(enviats[0]?.subject).toContain("Urgent");

    const pending = await db.select().from(alerts).where(isNull(alerts.notifiedAt));
    expect(pending.map((a) => a.title)).toEqual(["Normal"]);
  });

  test("els avisos descartats no s'envien", async () => {
    await createAlert();
    await db.update(alerts).set({ status: "dismissed" });

    expect(await notifyPending()).toBe("Cap avis pendent d'enviar");
  });

  test("un error del servidor no trenca res", async () => {
    serverCrashes = true;
    await createAlert();

    expect(await sendMail("Prova", "<p>hola</p>", "hola")).toBe(false);
    expect(await notifyPending()).toContain("ha fallat");
  });
});

describe("cada espai te els seus destinataris", () => {
  test("l'avis d'un espai nomes va a qui li pertoca", async () => {
    const [workspace] = await db
      .insert(ledgers)
      .values({
        code: "calella",
        name: "Calella",
        description: "",
        currency: "EUR",
        color: "#2563eb",
        overdraftThreshold: "0.00",
        position: 0,
        isActive: true,
        alertRecipients: ["sogra@example.com"],
      })
      .returning();

    await createAlert("Descobert a Calella", "warning", "c1", workspace?.id ?? 0);
    await createAlert("Sincronitzacio fallida", "warning", "g1", null);

    await notifyPending();

    expect(enviats.length).toBe(2);
    const byWorkspace = enviats.find((c) => c.subject.includes("Calella"));
    const general = enviats.find((c) => !c.subject.includes("Calella"));

    expect(byWorkspace?.to).toEqual(["sogra@example.com"]);
    expect(general?.to).toEqual(["etor@example.com"]);
    expect(byWorkspace?.html).not.toContain("Sincronitzacio fallida");
  });

  test("l'espai apareix al subtitol del resum", async () => {
    const [workspace] = await db
      .insert(ledgers)
      .values({
        code: "pardals",
        name: "Pardals",
        description: "",
        currency: "EUR",
        color: "#2563eb",
        overdraftThreshold: "0.00",
        position: 0,
        isActive: true,
        alertRecipients: [],
      })
      .returning();

    await createAlert("Un avis", "warning", "p1", workspace?.id ?? 0);
    await notifyPending();

    expect(enviats[0]?.html).toContain("Pardals");
    // With no recipients of its own, it falls back to the general ones.
    expect(enviats[0]?.to).toEqual(["etor@example.com"]);
  });
});
