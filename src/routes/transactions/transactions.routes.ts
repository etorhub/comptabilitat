/**
 * Rutes dels moviments.
 *
 * Cap resposta d'aqui no dibuixa mai una fila crua: tot passa per
 * `vistaMoviment()`, que es on s'aplica l'emmascarament.
 */

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";

import { ComptadorRevisio } from "../../components/layout.tsx";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import {
  accounts,
  categories,
  llmSuggestions,
  merchants,
  roleAtLeast,
  transactions,
} from "../../db/schema/index.ts";
import {
  clearToast,
  fragment,
  NotFoundError,
  page,
  pushUrl,
  toast,
  toastOnly,
  withOob,
} from "../../lib/http.ts";
import { currentUser } from "../../middleware/session.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { opcionsCategories } from "../../services/categories.ts";
import { construeixReglaApresa } from "../../services/classification.ts";
import { comptaPerRevisar } from "../../services/comptadors.ts";
import { recordaEleccioComerc } from "../../services/merchants.ts";
import {
  afegeixEtiqueta,
  afegeixEtiquetaEnBloc,
  etiquetesEspai,
  treuEtiqueta,
} from "../../services/tags.ts";
import {
  filaMoviment,
  llistaMoviments,
  movimentDeLespai,
  safataRevisio,
} from "../../services/transactions.ts";
import { Fila, FilaConcepte, RevisioFeta, Taula } from "./transactions.fragment.tsx";
import { ReviewPage, TransactionsPage } from "./transactions.page.tsx";
import {
  bulkCategorizeSchema,
  bulkTagSchema,
  categorizeSchema,
  maskSchema,
  PER_PAGINA,
  tagAddRowSchema,
  tagMutationSchema,
  transactionFiltersSchema,
  transactionFiltersToQuery,
} from "./transactions.schema.ts";

export const transactionsRoutes = new Hono();

function idDeLaRuta(valor: string | undefined): number {
  const id = Number.parseInt(valor ?? "", 10);
  if (Number.isNaN(id)) throw new NotFoundError("Aquest moviment no existeix");
  return id;
}

async function dades(ledgerId: number, query: Record<string, string>) {
  const filters = transactionFiltersSchema.parse(query);
  const [pagina, grups, comptes, etiquetesConegudes] = await Promise.all([
    llistaMoviments(ledgerId, {
      accountId: filters.compte,
      dataDes: filters.des,
      dataFins: filters.fins,
      categoryIds: filters.categoria === null ? [] : [filters.categoria],
      merchantId: null,
      cerca: filters.cerca,
      etiqueta: filters.etiqueta,
      nomesRevisio: filters.revisio,
      nomesSenseClassificar: filters.sense_classificar,
      incloTraspassos: filters.traspassos,
      limit: PER_PAGINA,
      offset: filters.pagina * PER_PAGINA,
    }),
    opcionsCategories(ledgerId),
    db
      .select({ valor: accounts.id, text: accounts.name })
      .from(accounts)
      .where(eq(accounts.ledgerId, ledgerId))
      .orderBy(accounts.name),
    etiquetesEspai(ledgerId),
  ]);
  return { filters, pagina, grups, comptes, etiquetesConegudes };
}

/** La categoria ha de ser d'aquest espai. */
async function categoriaValida(categoryId: number | null, ledgerId: number): Promise<boolean> {
  if (categoryId === null) return true;
  const [categoria] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.ledgerId, ledgerId)))
    .limit(1);
  return categoria !== undefined;
}

// --- Pagina ----------------------------------------------------------------

transactionsRoutes.get("/", async (c) => {
  const espai = currentWorkspace(c);
  const { filters, pagina, grups, comptes, etiquetesConegudes } = await dades(
    espai.id,
    c.req.query(),
  );

  return page(
    c,
    await workspacePage(
      c,
      "Moviments",
      TransactionsPage({
        codi: espai.code,
        pagina,
        grups,
        comptes,
        filters,
        potEditar: roleAtLeast(currentRole(c), "editor"),
        etiquetesConegudes,
      }),
    ),
  );
});

// --- Fragments -------------------------------------------------------------

transactionsRoutes.get("/fragment/taula", async (c) => {
  const espai = currentWorkspace(c);
  const { filters, pagina, grups, etiquetesConegudes } = await dades(espai.id, c.req.query());

  pushUrl(c, `/e/${espai.code}/moviments${transactionFiltersToQuery(filters)}`);

  return fragment(
    c,
    Taula({
      codi: espai.code,
      pagina,
      grups,
      filters,
      potEditar: roleAtLeast(currentRole(c), "editor"),
      etiquetesConegudes,
    }),
  );
});

/** Una fila sola, per cancel·lar una edicio. */
transactionsRoutes.get("/:id/fragment/fila", async (c) => {
  const espai = currentWorkspace(c);
  const moviment = await movimentDeLespai(idDeLaRuta(c.req.param("id")), espai.id);
  const [grups, etiquetesConegudes] = await Promise.all([
    opcionsCategories(espai.id),
    etiquetesEspai(espai.id),
  ]);

  return fragment(
    c,
    await withOob(
      Fila({
        codi: espai.code,
        moviment,
        grups,
        potEditar: roleAtLeast(currentRole(c), "editor"),
        etiquetesConegudes,
      }),
      clearToast(),
    ),
  );
});

/** La fila amb el desplegable de categoria obert per editar-la. */
transactionsRoutes.get("/:id/fragment/categoria", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const moviment = await movimentDeLespai(idDeLaRuta(c.req.param("id")), espai.id);
  const [grups, etiquetesConegudes] = await Promise.all([
    opcionsCategories(espai.id),
    etiquetesEspai(espai.id),
  ]);

  return fragment(
    c,
    Fila({
      codi: espai.code,
      moviment,
      grups,
      potEditar: true,
      editantCategoria: true,
      etiquetesConegudes,
    }),
  );
});

/** La fila convertida en el camp de l'alias. */
transactionsRoutes.get("/:id/fragment/concepte", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const moviment = await movimentDeLespai(idDeLaRuta(c.req.param("id")), espai.id);
  return fragment(c, FilaConcepte({ codi: espai.code, moviment }));
});

// --- Mutacions -------------------------------------------------------------

/** Torna la fila actualitzada, el comptador de revisio i un avis. */
async function respostaFila(
  c: Parameters<typeof fragment>[0],
  espaiId: number,
  codi: string,
  id: number,
  missatge?: { text: string; to: "success" | "info" },
) {
  const [moviment, grups, perRevisar, etiquetesConegudes] = await Promise.all([
    movimentDeLespai(id, espaiId),
    opcionsCategories(espaiId),
    comptaPerRevisar(espaiId),
    etiquetesEspai(espaiId),
  ]);

  return fragment(
    c,
    await withOob(
      Fila({ codi, moviment, grups, potEditar: true, etiquetesConegudes }),
      ComptadorRevisio(perRevisar, true),
      missatge ? toast(missatge.text, missatge.to) : clearToast(),
    ),
  );
}

/**
 * Canvi de categoria d'un moviment.
 *
 * Es una decisio d'una persona: queda amb `category_source = 'user'` i cap
 * regla ni cap comerç no la tornara a tocar. Per defecte tambe es recorda per
 * a tot el comerç d'aquest espai.
 */
transactionsRoutes.post("/:id/categoria", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const user = currentUser(c);
  const id = idDeLaRuta(c.req.param("id"));
  const parsed = categorizeSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) return toastOnly(c, "La categoria no es valida", 422);
  if (!(await categoriaValida(parsed.data.category_id, espai.id))) {
    return toastOnly(c, "La categoria no es d'aquest espai", 422);
  }

  const fila = await filaMoviment(id, espai.id);

  await db
    .update(transactions)
    .set({
      categoryId: parsed.data.category_id,
      categorySource: "user",
      categoryConfidence: 1,
      needsReview: false,
    })
    .where(eq(transactions.id, id));

  let recordat = 0;
  if (parsed.data.recorda_comerc && fila.merchantId !== null) {
    const [comerc] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, fila.merchantId))
      .limit(1);
    if (comerc) recordat = await recordaEleccioComerc(comerc, parsed.data.category_id, true);
  }

  if (parsed.data.crea_regla) {
    await construeixReglaApresa(
      {
        ledgerId: espai.id,
        normalizedDescription: fila.normalizedDescription,
        counterparty: fila.counterparty,
      },
      parsed.data.category_id,
      user.id,
    );
  }

  return respostaFila(
    c,
    espai.id,
    espai.code,
    id,
    recordat > 1
      ? { text: `Recordat per a ${recordat} moviments d'aquest comerç`, to: "success" }
      : undefined,
  );
});

/**
 * L'alias que amaga el concepte del banc.
 *
 * Si el moviment es una pota d'un traspas, l'alias es posa tambe a l'altra:
 * si no, el mateix moviment sortiria amagat en un compte i sencer a l'altre.
 */
transactionsRoutes.post("/:id/concepte", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const parsed = maskSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    const moviment = await movimentDeLespai(id, espai.id);
    return fragment(
      c,
      await withOob(
        FilaConcepte({ codi: espai.code, moviment }),
        toast("El text es massa llarg"),
      ),
      422,
    );
  }

  const fila = await filaMoviment(id, espai.id);
  const alies = parsed.data.display_description;

  await db
    .update(transactions)
    .set({ displayDescription: alies })
    .where(eq(transactions.id, id));

  if (fila.transferGroupId !== null) {
    await db
      .update(transactions)
      .set({ displayDescription: alies })
      .where(
        and(eq(transactions.transferGroupId, fila.transferGroupId), ne(transactions.id, id)),
      );
  }

  return respostaFila(c, espai.id, espai.code, id, {
    text: alies === null ? "El concepte del banc torna a ser visible" : "Concepte amagat",
    to: "success",
  });
});

/**
 * Classificacio en bloc.
 *
 * Els identificadors venen de les caselles del formulari, de manera que el que
 * s'aplica es sempre el que hi ha a la pantalla. Aixo arregla el que passava a
 * l'aplicacio de React, on la seleccio vivia a la memoria del navegador i
 * sobrevivia als canvis de filtre i de pagina.
 */
transactionsRoutes.post("/bloc", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const cos = await c.req.parseBody({ all: true });
  const parsed = bulkCategorizeSchema.safeParse(cos);

  if (!parsed.success) {
    return toastOnly(c, "No hi ha cap moviment triat", 422);
  }
  if (!(await categoriaValida(parsed.data.category_id, espai.id))) {
    return toastOnly(c, "La categoria no es d'aquest espai", 422);
  }

  // Nomes els que son d'aquest espai: aixi no s'hi pot colar un identificador.
  const demanats = [...new Set(parsed.data.moviment)];
  const meus = await db
    .select({ id: transactions.id, merchantId: transactions.merchantId })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, espai.id), inArray(transactions.id, demanats)));

  // **Tot o res.** Si algun identificador no es d'aquest espai, no s'aplica
  // a cap: una peticio a mitges deixaria l'usuari sense saber que ha canviat.
  if (meus.length !== demanats.length) {
    return toastOnly(c, "No s'ha trobat", 404);
  }

  await db
    .update(transactions)
    .set({
      categoryId: parsed.data.category_id,
      categorySource: "user",
      categoryConfidence: 1,
      needsReview: false,
    })
    .where(
      inArray(
        transactions.id,
        meus.map((m) => m.id),
      ),
    );

  if (parsed.data.recorda_comerc) {
    const comercIds = [
      ...new Set(meus.map((m) => m.merchantId).filter((x): x is number => x !== null)),
    ];
    for (const comercId of comercIds) {
      const [comerc] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, comercId))
        .limit(1);
      if (comerc) await recordaEleccioComerc(comerc, parsed.data.category_id, true);
    }
  }

  const { filters, pagina, grups, etiquetesConegudes } = await dades(espai.id, c.req.query());
  const perRevisar = await comptaPerRevisar(espai.id);

  // Els filtres venen a l'adreça del `hx-post`, de manera que la taula torna
  // amb la mateixa vista que hi havia; i es torna a empenyer l'adreça perque
  // la barra d'adreces i el que es veu no diguin coses diferents.
  pushUrl(c, `/e/${espai.code}/moviments${transactionFiltersToQuery(filters)}`);

  return fragment(
    c,
    await withOob(
      Taula({
        codi: espai.code,
        pagina,
        grups,
        filters,
        potEditar: true,
        etiquetesConegudes,
      }),
      ComptadorRevisio(perRevisar, true),
      toast(
        `S'ha posat la categoria a ${meus.length} ${meus.length === 1 ? "moviment" : "moviments"}`,
        "success",
      ),
    ),
  );
});

/**
 * Etiqueta en bloc els moviments triats.
 *
 * Mateixa garantia que la categoria en bloc: tot o res, i nomes ids de
 * l'espai.
 */
transactionsRoutes.post("/bloc/etiquetes", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const cos = await c.req.parseBody({ all: true });
  const parsed = bulkTagSchema.safeParse(cos);

  if (!parsed.success) {
    const missatge =
      parsed.error.issues[0]?.message === "No hi ha cap moviment triat"
        ? "No hi ha cap moviment triat"
        : "L'etiqueta no es valida";
    return toastOnly(c, missatge, 422);
  }

  try {
    await afegeixEtiquetaEnBloc(parsed.data.moviment, espai.id, parsed.data.etiqueta_bloc);
  } catch (err) {
    if (err instanceof NotFoundError) return toastOnly(c, "No s'ha trobat", 404);
    throw err;
  }

  const { filters, pagina, grups, etiquetesConegudes } = await dades(espai.id, c.req.query());
  pushUrl(c, `/e/${espai.code}/moviments${transactionFiltersToQuery(filters)}`);

  return fragment(
    c,
    await withOob(
      Taula({
        codi: espai.code,
        pagina,
        grups,
        filters,
        potEditar: true,
        etiquetesConegudes,
      }),
      toast(
        `S'ha posat l'etiqueta a ${parsed.data.moviment.length} ${
          parsed.data.moviment.length === 1 ? "moviment" : "moviments"
        }`,
        "success",
      ),
    ),
  );
});

/** Afegeix una etiqueta a un moviment des de la fila. */
transactionsRoutes.post("/:id/etiquetes", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  // Assegura que el moviment es de l'espai abans de validar el cos.
  await movimentDeLespai(id, espai.id);
  const parsed = tagAddRowSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    const [grups, etiquetesConegudes, moviment] = await Promise.all([
      opcionsCategories(espai.id),
      etiquetesEspai(espai.id),
      movimentDeLespai(id, espai.id),
    ]);
    return fragment(
      c,
      await withOob(
        Fila({ codi: espai.code, moviment, grups, potEditar: true, etiquetesConegudes }),
        toast(parsed.error.issues[0]?.message ?? "L'etiqueta no es valida"),
      ),
      422,
    );
  }

  await afegeixEtiqueta(id, espai.id, parsed.data.nova_etiqueta);
  return respostaFila(c, espai.id, espai.code, id);
});

/** Treu una etiqueta d'un moviment. */
transactionsRoutes.post("/:id/etiquetes/treure", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const parsed = tagMutationSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return toastOnly(c, "L'etiqueta no es valida", 422);
  }

  await treuEtiqueta(id, espai.id, parsed.data.etiqueta);
  return respostaFila(c, espai.id, espai.code, id);
});

// --- Safata de revisio -------------------------------------------------------

transactionsRoutes.get("/revisio", async (c) => {
  const espai = currentWorkspace(c);
  const [{ items, total }, grups] = await Promise.all([
    safataRevisio(espai.id),
    opcionsCategories(espai.id),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Per revisar",
      ReviewPage({ codi: espai.code, items, grups, total }),
    ),
  );
});

/**
 * Confirmar la categoria d'un moviment de la cua.
 *
 * Es exactament el mateix que canviar-la des de la llista —queda com a
 * decisio d'una persona i es recorda per al comerç—, pero la resposta treu
 * l'element de la cua en lloc de redibuixar-ne la fila.
 */
transactionsRoutes.post("/:id/revisa", requireEditor, async (c) => {
  const espai = currentWorkspace(c);
  const id = idDeLaRuta(c.req.param("id"));
  const parsed = categorizeSchema.safeParse(await c.req.parseBody());

  if (!parsed.success || parsed.data.category_id === null) {
    return toastOnly(c, "Tria una categoria per confirmar-lo", 422);
  }
  if (!(await categoriaValida(parsed.data.category_id, espai.id))) {
    return toastOnly(c, "La categoria no es d'aquest espai", 422);
  }

  const fila = await filaMoviment(id, espai.id);

  await db
    .update(transactions)
    .set({
      categoryId: parsed.data.category_id,
      categorySource: "user",
      categoryConfidence: 1,
      needsReview: false,
    })
    .where(eq(transactions.id, id));

  // Tanca la proposta del model dient si l'encertava.
  if (fila.merchantId !== null) {
    const [proposta] = await db
      .select()
      .from(llmSuggestions)
      .where(
        and(eq(llmSuggestions.merchantId, fila.merchantId), isNull(llmSuggestions.accepted)),
      )
      .limit(1);
    if (proposta) {
      await db
        .update(llmSuggestions)
        .set({
          accepted: proposta.suggestedCategoryId === parsed.data.category_id,
          reviewedAt: new Date(),
        })
        .where(eq(llmSuggestions.id, proposta.id));
    }

    if (parsed.data.recorda_comerc) {
      const [comerc] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, fila.merchantId))
        .limit(1);
      if (comerc) await recordaEleccioComerc(comerc, parsed.data.category_id, true);
    }
  }

  const perRevisar = await comptaPerRevisar(espai.id);

  return fragment(
    c,
    await withOob(
      RevisioFeta(id),
      ComptadorRevisio(perRevisar, true),
      toast("Confirmat", "success"),
    ),
  );
});
