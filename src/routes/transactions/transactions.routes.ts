/**
 * Rutes dels moviments.
 *
 * Cap resposta d'aqui no dibuixa mai una fila crua: tot passa per
 * `vistaMoviment()`, que es on s'aplica l'emmascarament.
 */

import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";

import { ReviewCounter } from "../../components/layout.ts";
import { workspacePage } from "../../components/workspace-page.ts";
import { db } from "../../db/client.ts";
import { accounts, categories, roleAtLeast, transactions } from "../../db/schema/index.ts";
import {
  NotFoundError,
  clearToast,
  fragment,
  idFromRoute,
  page,
  pushUrl,
  toast,
  toastOnly,
  withOob,
} from "../../lib/http.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import { categoryOptions } from "../../services/categories.ts";
import {
  categorizeBulk,
  categorizeTransaction,
  confirmFromReview,
} from "../../services/categoritzacio.ts";
import { countToReview } from "../../services/comptadors.ts";
import { addTag, addTagBulk, workspaceTags, removeTag } from "../../services/tags.ts";
import {
  transactionRow,
  listTransactions,
  transactionInWorkspace,
  reviewQueue,
  cardsAvailable,
} from "../../services/transactions.ts";
import {
  Row,
  FilaConcepte,
  FiltreTargetes,
  ReviewDone,
  Table,
} from "./transactions.fragment.ts";
import { ReviewPage, TransactionsPage } from "./transactions.page.ts";
import {
  bulkCategorizeSchema,
  bulkTagSchema,
  categorizeSchema,
  maskSchema,
  PER_PAGE,
  tagAddRowSchema,
  tagMutationSchema,
  transactionFiltersSchema,
  transactionFiltersToQuery,
} from "./transactions.schema.ts";

export const transactionsRoutes = new Hono();

async function data(ledgerId: number, query: Record<string, string | string[]>) {
  const filters = transactionFiltersSchema.parse(query);
  const [paged, groups, accountList, knownTags, knownCards] = await Promise.all([
    listTransactions(ledgerId, {
      accountId: filters.compte,
      dateFrom: filters.des,
      dateTo: filters.fins,
      categoryIds: filters.categoria === null ? [] : [filters.categoria],
      merchantId: null,
      search: filters.cerca,
      tag: filters.etiqueta,
      operationType: filters.type,
      cards: filters.card,
      onlyReview: filters.revisio,
      onlyUnclassified: filters.sense_classificar,
      includeTransfers: filters.traspassos,
      limit: PER_PAGE,
      offset: filters.pagina * PER_PAGE,
    }),
    categoryOptions(ledgerId),
    db
      .select({ value: accounts.id, text: accounts.name })
      .from(accounts)
      .where(eq(accounts.ledgerId, ledgerId))
      .orderBy(accounts.name),
    workspaceTags(ledgerId),
    cardsAvailable(ledgerId, filters.compte),
  ]);
  return { filters, page: paged, groups, accountList, knownTags, knownCards };
}

/** Query string amb `tipus` i `targeta` repetits (checkboxes multiples). */
function requestQuery(c: {
  req: { query: () => Record<string, string>; queries: (k: string) => string[] | undefined };
}) {
  let q: Record<string, string | string[]> = c.req.query();
  const type = c.req.queries("tipus") ?? [];
  if (type.length > 0) q = { ...q, type };
  const card = c.req.queries("targeta") ?? [];
  if (card.length > 0) q = { ...q, card };
  return q;
}

/** La categoria ha de ser d'aquest espai. */
async function validCategory(categoryId: number | null, ledgerId: number): Promise<boolean> {
  if (categoryId === null) return true;
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.ledgerId, ledgerId)))
    .limit(1);
  return category !== undefined;
}

// --- Pagina ----------------------------------------------------------------

transactionsRoutes.get("/", async (c) => {
  const workspace = currentWorkspace(c);
  const {
    page: paged,
    filters,
    groups,
    accountList,
    knownTags,
    knownCards,
  } = await data(workspace.id, requestQuery(c));

  return page(
    c,
    await workspacePage(
      c,
      "Moviments",
      TransactionsPage({
        code: workspace.code,
        page: paged,
        groups,
        accountList,
        filters,
        canEdit: roleAtLeast(currentRole(c), "editor"),
        knownTags,
        knownCards,
      }),
    ),
  );
});

// --- Fragments -------------------------------------------------------------

transactionsRoutes.get("/fragment/taula", async (c) => {
  const workspace = currentWorkspace(c);
  const {
    page: paged,
    filters,
    groups,
    knownTags,
    knownCards,
  } = await data(workspace.id, requestQuery(c));

  pushUrl(c, `/e/${workspace.code}/moviments${transactionFiltersToQuery(filters)}`);

  return fragment(
    c,
    await withOob(
      Table({
        code: workspace.code,
        page: paged,
        groups,
        filters,
        canEdit: roleAtLeast(currentRole(c), "editor"),
        knownTags,
      }),
      FiltreTargetes({
        cards: knownCards,
        seleccionades: filters.card,
        oob: true,
      }),
    ),
  );
});

/** Una fila sola, per cancel·lar una edicio. */
transactionsRoutes.get("/:id/fragment/fila", async (c) => {
  const workspace = currentWorkspace(c);
  const transaction = await transactionInWorkspace(
    idFromRoute(c.req.param("id"), "Aquest moviment no existeix"),
    workspace.id,
  );
  const [groups, knownTags] = await Promise.all([
    categoryOptions(workspace.id),
    workspaceTags(workspace.id),
  ]);

  return fragment(
    c,
    await withOob(
      Row({
        code: workspace.code,
        transaction,
        groups,
        canEdit: roleAtLeast(currentRole(c), "editor"),
        knownTags,
      }),
      clearToast(),
    ),
  );
});

/** La fila amb el desplegable de categoria obert per editar-la. */
transactionsRoutes.get("/:id/fragment/categoria", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const transaction = await transactionInWorkspace(
    idFromRoute(c.req.param("id"), "Aquest moviment no existeix"),
    workspace.id,
  );
  const [groups, knownTags] = await Promise.all([
    categoryOptions(workspace.id),
    workspaceTags(workspace.id),
  ]);

  return fragment(
    c,
    Row({
      code: workspace.code,
      transaction,
      groups,
      canEdit: true,
      editantCategoria: true,
      knownTags,
    }),
  );
});

/** La fila convertida en el camp de l'alias. */
transactionsRoutes.get("/:id/fragment/concepte", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const transaction = await transactionInWorkspace(
    idFromRoute(c.req.param("id"), "Aquest moviment no existeix"),
    workspace.id,
  );
  return fragment(c, FilaConcepte({ code: workspace.code, transaction }));
});

// --- Mutacions -------------------------------------------------------------

/** Torna la fila actualitzada, el comptador de revisio i un avis. */
async function rowResponse(
  c: Parameters<typeof fragment>[0],
  workspaceId: number,
  code: string,
  id: number,
  message?: { text: string; to: "success" | "info" },
) {
  const [transaction, groups, perRevisar, knownTags] = await Promise.all([
    transactionInWorkspace(id, workspaceId),
    categoryOptions(workspaceId),
    countToReview(workspaceId),
    workspaceTags(workspaceId),
  ]);

  return fragment(
    c,
    await withOob(
      Row({ code, transaction, groups, canEdit: true, knownTags }),
      ReviewCounter(perRevisar, true),
      message ? toast(message.text, message.to) : clearToast(),
    ),
  );
}

/**
 * Canvi de categoria d'un moviment.
 *
 * Es una decisio d'una persona: queda amb `category_source = 'user'` i cap
 * comerç no la tornara a tocar. Per defecte tambe es recorda per a tot el
 * comerç d'aquest espai.
 */
transactionsRoutes.post("/:id/categoria", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest moviment no existeix");
  const parsed = categorizeSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) return toastOnly(c, "La categoria no es valida", 422);
  if (!(await validCategory(parsed.data.category_id, workspace.id))) {
    return toastOnly(c, "La categoria no es d'aquest espai", 422);
  }

  const row = await transactionRow(id, workspace.id);

  const { recordats } = await categorizeTransaction(id, row, parsed.data.category_id, {
    rememberMerchant: parsed.data.recorda_comerc,
  });

  return rowResponse(
    c,
    workspace.id,
    workspace.code,
    id,
    recordats > 1
      ? { text: `Recordat per a ${recordats} moviments d'aquest comerç`, to: "success" }
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
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest moviment no existeix");
  const parsed = maskSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    const transaction = await transactionInWorkspace(id, workspace.id);
    return fragment(
      c,
      await withOob(
        FilaConcepte({ code: workspace.code, transaction }),
        toast("El text es massa llarg"),
      ),
      422,
    );
  }

  const row = await transactionRow(id, workspace.id);
  const alies = parsed.data.display_description;

  await db
    .update(transactions)
    .set({ displayDescription: alies })
    .where(eq(transactions.id, id));

  if (row.transferGroupId !== null) {
    await db
      .update(transactions)
      .set({ displayDescription: alies })
      .where(
        and(eq(transactions.transferGroupId, row.transferGroupId), ne(transactions.id, id)),
      );
  }

  return rowResponse(c, workspace.id, workspace.code, id, {
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
  const workspace = currentWorkspace(c);
  const body = await c.req.parseBody({ all: true });
  const parsed = bulkCategorizeSchema.safeParse(body);

  if (!parsed.success) {
    return toastOnly(c, "No hi ha cap moviment triat", 422);
  }
  if (!(await validCategory(parsed.data.category_id, workspace.id))) {
    return toastOnly(c, "La categoria no es d'aquest espai", 422);
  }

  // El servei ho fa tot o res i llança un 404 si algun identificador no es
  // d'aquest espai: una peticio a mitges deixaria l'usuari sense saber que ha
  // canviat.
  const { aplicats } = await categorizeBulk(
    parsed.data.transaction,
    workspace.id,
    parsed.data.category_id,
    { rememberMerchant: parsed.data.recorda_comerc },
  );

  const { page: paged, filters, groups, knownTags } = await data(workspace.id, requestQuery(c));
  const perRevisar = await countToReview(workspace.id);

  // Els filtres venen a l'adreça del `hx-post`, de manera que la taula torna
  // amb la mateixa vista que hi havia; i es torna a empenyer l'adreça perque
  // la barra d'adreces i el que es veu no diguin coses diferents.
  pushUrl(c, `/e/${workspace.code}/moviments${transactionFiltersToQuery(filters)}`);

  return fragment(
    c,
    await withOob(
      Table({
        code: workspace.code,
        page: paged,
        groups,
        filters,
        canEdit: true,
        knownTags,
      }),
      ReviewCounter(perRevisar, true),
      toast(
        `S'ha posat la categoria a ${aplicats} ${aplicats === 1 ? "moviment" : "moviments"}`,
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
  const workspace = currentWorkspace(c);
  const body = await c.req.parseBody({ all: true });
  const parsed = bulkTagSchema.safeParse(body);

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message === "No hi ha cap moviment triat"
        ? "No hi ha cap moviment triat"
        : "L'etiqueta no es valida";
    return toastOnly(c, message, 422);
  }

  try {
    await addTagBulk(parsed.data.transaction, workspace.id, parsed.data.etiqueta_bloc);
  } catch (err) {
    if (err instanceof NotFoundError) return toastOnly(c, "No s'ha trobat", 404);
    throw err;
  }

  const { page: paged, filters, groups, knownTags } = await data(workspace.id, requestQuery(c));
  pushUrl(c, `/e/${workspace.code}/moviments${transactionFiltersToQuery(filters)}`);

  return fragment(
    c,
    await withOob(
      Table({
        code: workspace.code,
        page: paged,
        groups,
        filters,
        canEdit: true,
        knownTags,
      }),
      toast(
        `S'ha posat l'etiqueta a ${parsed.data.transaction.length} ${
          parsed.data.transaction.length === 1 ? "moviment" : "moviments"
        }`,
        "success",
      ),
    ),
  );
});

/** Afegeix una etiqueta a un moviment des de la fila. */
transactionsRoutes.post("/:id/etiquetes", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest moviment no existeix");
  // Assegura que el moviment es de l'espai abans de validar el cos.
  await transactionInWorkspace(id, workspace.id);
  const parsed = tagAddRowSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    const [groups, knownTags, transaction] = await Promise.all([
      categoryOptions(workspace.id),
      workspaceTags(workspace.id),
      transactionInWorkspace(id, workspace.id),
    ]);
    return fragment(
      c,
      await withOob(
        Row({ code: workspace.code, transaction, groups, canEdit: true, knownTags }),
        toast(parsed.error.issues[0]?.message ?? "L'etiqueta no es valida"),
      ),
      422,
    );
  }

  await addTag(id, workspace.id, parsed.data.nova_etiqueta);
  return rowResponse(c, workspace.id, workspace.code, id);
});

/** Treu una etiqueta d'un moviment. */
transactionsRoutes.post("/:id/etiquetes/treure", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest moviment no existeix");
  const parsed = tagMutationSchema.safeParse(await c.req.parseBody());

  if (!parsed.success) {
    return toastOnly(c, "L'etiqueta no es valida", 422);
  }

  await removeTag(id, workspace.id, parsed.data.tag);
  return rowResponse(c, workspace.id, workspace.code, id);
});

// --- Safata de revisio -------------------------------------------------------

transactionsRoutes.get("/revisio", async (c) => {
  const workspace = currentWorkspace(c);
  const [{ items, total }, groups] = await Promise.all([
    reviewQueue(workspace.id),
    categoryOptions(workspace.id),
  ]);

  return page(
    c,
    await workspacePage(
      c,
      "Per revisar",
      ReviewPage({ code: workspace.code, items, groups, total }),
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
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest moviment no existeix");
  const parsed = categorizeSchema.safeParse(await c.req.parseBody());

  if (!parsed.success || parsed.data.category_id === null) {
    return toastOnly(c, "Tria una categoria per confirmar-lo", 422);
  }
  if (!(await validCategory(parsed.data.category_id, workspace.id))) {
    return toastOnly(c, "La categoria no es d'aquest espai", 422);
  }

  const row = await transactionRow(id, workspace.id);

  // El mateix que canviar-la des de la llista, i a mes tanca la proposta del
  // model dient si l'encertava.
  await confirmFromReview(id, row, parsed.data.category_id, {
    rememberMerchant: parsed.data.recorda_comerc,
  });

  const perRevisar = await countToReview(workspace.id);

  return fragment(
    c,
    await withOob(
      ReviewDone(id),
      ReviewCounter(perRevisar, true),
      toast("Confirmat", "success"),
    ),
  );
});
