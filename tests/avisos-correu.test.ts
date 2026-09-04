/**
 * Avisos per correu.
 *
 * Port de `backend/tests/test_notifications.py`. El servidor de correu es
 * simulat: cap prova no toca res de fora.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { isNull } from "drizzle-orm";

interface CorreuEnviat {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

const enviats: CorreuEnviat[] = [];
let elServidorPeta = false;

mock.module("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: (opcions: CorreuEnviat) => {
        if (elServidorPeta) throw new Error("servidor caigut");
        enviats.push(opcions);
        return Promise.resolve({ messageId: "1" });
      },
      close: () => undefined,
    }),
  },
}));

const { db } = await import("../src/db/client.ts");
const { alerts, ledgers } = await import("../src/db/schema/index.ts");
const { config } = await import("../src/lib/config.ts");
const { enviaCorreu, renderitzaResum } = await import("../src/lib/email.ts");
const { notificaPendents } = await import("../src/services/notify.ts");

import type { AlertSeverity } from "../src/db/schema/enums.ts";

/** El `config` es `as const` pel tipus, pero els camps es poden tocar. */
const ajustos = config as {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  alertRecipients: string[];
};

function configuraElCorreu(): void {
  ajustos.smtpHost = "smtp.example.com";
  ajustos.smtpPort = 587;
  ajustos.smtpUser = "usuari";
  ajustos.smtpPassword = "secret";
  ajustos.smtpFrom = "comptes@example.com";
  ajustos.alertRecipients = ["etor@example.com"];
}

async function creaAvis(
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
  elServidorPeta = false;
  configuraElCorreu();
  await db.delete(alerts);
  await db.delete(ledgers);
});

describe("el resum", () => {
  test("inclou tots els avisos i l'adreça de l'aplicacio", async () => {
    const { html, text } = await renderitzaResum(
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
    const { html } = await renderitzaResum(
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
    await creaAvis();

    const resultat = await notificaPendents();

    expect(resultat).toContain("no hi ha destinataris");
    const [avis] = await db.select().from(alerts);
    expect(avis?.notifiedAt).toBeNull();
  });

  test("els avisos s'envien i es marquen", async () => {
    await creaAvis("Primer", "warning", "1");
    await creaAvis("Segon", "warning", "2");

    const resultat = await notificaPendents();

    expect(resultat).toContain("2 avisos enviats");
    expect(enviats.length).toBe(1);
    expect(enviats[0]?.to).toEqual(["etor@example.com"]);
    expect(enviats[0]?.subject).toContain("Resum d'avisos (2)");

    const senseNotificar = await db.select().from(alerts).where(isNull(alerts.notifiedAt));
    expect(senseNotificar.length).toBe(0);
  });

  test("no es repeteix l'enviament", async () => {
    await creaAvis();
    await notificaPendents();

    expect(await notificaPendents()).toBe("Cap avis pendent d'enviar");
    expect(enviats.length).toBe(1);
  });

  test("el mode urgent nomes envia els critics", async () => {
    await creaAvis("Normal", "warning", "1");
    await creaAvis("Urgent", "critical", "2");

    const resultat = await notificaPendents(true);

    expect(resultat).toContain("1 avisos enviats");
    expect(enviats[0]?.subject).toContain("Urgent");

    const pendents = await db.select().from(alerts).where(isNull(alerts.notifiedAt));
    expect(pendents.map((a) => a.title)).toEqual(["Normal"]);
  });

  test("els avisos descartats no s'envien", async () => {
    await creaAvis();
    await db.update(alerts).set({ status: "dismissed" });

    expect(await notificaPendents()).toBe("Cap avis pendent d'enviar");
  });

  test("un error del servidor no trenca res", async () => {
    elServidorPeta = true;
    await creaAvis();

    expect(await enviaCorreu("Prova", "<p>hola</p>", "hola")).toBe(false);
    expect(await notificaPendents()).toContain("ha fallat");
  });
});

describe("cada espai te els seus destinataris", () => {
  test("l'avis d'un espai nomes va a qui li pertoca", async () => {
    const [espai] = await db
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

    await creaAvis("Descobert a Calella", "warning", "c1", espai?.id ?? 0);
    await creaAvis("Sincronitzacio fallida", "warning", "g1", null);

    await notificaPendents();

    expect(enviats.length).toBe(2);
    const perEspai = enviats.find((c) => c.subject.includes("Calella"));
    const general = enviats.find((c) => !c.subject.includes("Calella"));

    expect(perEspai?.to).toEqual(["sogra@example.com"]);
    expect(general?.to).toEqual(["etor@example.com"]);
    expect(perEspai?.html).not.toContain("Sincronitzacio fallida");
  });

  test("l'espai apareix al subtitol del resum", async () => {
    const [espai] = await db
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

    await creaAvis("Un avis", "warning", "p1", espai?.id ?? 0);
    await notificaPendents();

    expect(enviats[0]?.html).toContain("Pardals");
    // Sense destinataris propis, cau als generals.
    expect(enviats[0]?.to).toEqual(["etor@example.com"]);
  });
});
