/**
 * Transaction routes.
 *
 * No response here ever draws a raw row: everything goes through
 * `transactionView()`, which is where the masking is applied.
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
} from "../../services/categorization.ts";
import { countToReview } from "../../services/counters.ts";
import { addTag, addTagBulk, workspaceTags, removeTag } from "../../services/tags.ts";
import {
  transactionRow,
  listTransactions,
  transactionInWorkspace,
  reviewQueue,
  cardsAvailable,
} from "../../services/transactions.ts";
import { Row, ConceptRow, CardFilter, ReviewDone, Table } from "./transactions.fragment.ts";
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
      dateTo: filters.to,
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

/** Query string with `tipus` and `targeta` repeated (multiple checkboxes). */
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

/** The category must belong to this workspace. */
async function validCategory(categoryId: number | null, ledgerId: number): Promise<boolean> {
  if (categoryId === null) return true;
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.ledgerId, ledgerId)))
    .limit(1);
  return category !== undefined;
}

// --- Page ------------------------------------------------------------------

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
      CardFilter({
        cards: knownCards,
        selected: filters.card,
        oob: true,
      }),
    ),
  );
});

/** A single row, for cancelling an edit. */
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

/** The row with the category dropdown open for editing. */
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
      editingCategory: true,
      knownTags,
    }),
  );
});

/** The row turned into the alias field. */
transactionsRoutes.get("/:id/fragment/concepte", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const transaction = await transactionInWorkspace(
    idFromRoute(c.req.param("id"), "Aquest moviment no existeix"),
    workspace.id,
  );
  return fragment(c, ConceptRow({ code: workspace.code, transaction }));
});

// --- Mutations -------------------------------------------------------------

/** Returns the updated row, the review counter and a toast. */
async function rowResponse(
  c: Parameters<typeof fragment>[0],
  workspaceId: number,
  code: string,
  id: number,
  message?: { text: string; to: "success" | "info" },
) {
  const [transaction, groups, toReview, knownTags] = await Promise.all([
    transactionInWorkspace(id, workspaceId),
    categoryOptions(workspaceId),
    countToReview(workspaceId),
    workspaceTags(workspaceId),
  ]);

  return fragment(
    c,
    await withOob(
      Row({ code, transaction, groups, canEdit: true, knownTags }),
      ReviewCounter(toReview, true),
      message ? toast(message.text, message.to) : clearToast(),
    ),
  );
}

/**
 * Category change of a transaction.
 *
 * This is a person's decision: it is stored with `category_source = 'user'`
 * and no merchant will touch it again. By default it is also remembered for
 * every transaction of that merchant in this workspace.
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

  const { remembered } = await categorizeTransaction(id, row, parsed.data.category_id, {
    rememberMerchant: parsed.data.recorda_comerc,
  });

  return rowResponse(
    c,
    workspace.id,
    workspace.code,
    id,
    remembered > 1
      ? { text: `Recordat per a ${remembered} moviments d'aquest comerç`, to: "success" }
      : undefined,
  );
});

/**
 * The alias that hides the bank's concept.
 *
 * If the transaction is one leg of a transfer, the alias is set on the other
 * one too: otherwise the same transaction would show masked in one account
 * and in full in the other.
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
        ConceptRow({ code: workspace.code, transaction }),
        toast("El text es massa llarg"),
      ),
      422,
    );
  }

  const row = await transactionRow(id, workspace.id);
  const alias = parsed.data.display_description;

  await db
    .update(transactions)
    .set({ displayDescription: alias })
    .where(eq(transactions.id, id));

  if (row.transferGroupId !== null) {
    await db
      .update(transactions)
      .set({ displayDescription: alias })
      .where(
        and(eq(transactions.transferGroupId, row.transferGroupId), ne(transactions.id, id)),
      );
  }

  return rowResponse(c, workspace.id, workspace.code, id, {
    text: alias === null ? "El concepte del banc torna a ser visible" : "Concepte amagat",
    to: "success",
  });
});

/**
 * Bulk classification.
 *
 * The ids come from the form's checkboxes, so what gets applied is always
 * what is on screen. This fixes what happened in the React application,
 * where the selection lived in the browser's memory and survived filter and
 * page changes.
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

  // The service does all of it or none, and throws a 404 if any id does not
  // belong to this workspace: a half-done request would leave the user not
  // knowing what changed.
  const { applied } = await categorizeBulk(
    parsed.data.transaction,
    workspace.id,
    parsed.data.category_id,
    { rememberMerchant: parsed.data.recorda_comerc },
  );

  const { page: paged, filters, groups, knownTags } = await data(workspace.id, requestQuery(c));
  const toReview = await countToReview(workspace.id);

  // The filters arrive in the URL of the `hx-post`, so the table comes back
  // with the same view it had; and the URL is pushed again so that the
  // address bar and what is on screen do not say different things.
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
      ReviewCounter(toReview, true),
      toast(
        `S'ha posat la categoria a ${applied} ${applied === 1 ? "moviment" : "moviments"}`,
        "success",
      ),
    ),
  );
});

/**
 * Bulk-tags the selected transactions.
 *
 * Same guarantee as the bulk category: all or nothing, and only ids from the
 * workspace.
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

/** Adds a tag to a transaction from the row. */
transactionsRoutes.post("/:id/etiquetes", requireEditor, async (c) => {
  const workspace = currentWorkspace(c);
  const id = idFromRoute(c.req.param("id"), "Aquest moviment no existeix");
  // Make sure the transaction belongs to the workspace before validating the body.
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

/** Removes a tag from a transaction. */
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

// --- Review tray -------------------------------------------------------------

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
 * Confirm the category of a transaction in the queue.
 *
 * Exactly the same as changing it from the list —it is stored as a person's
 * decision and remembered for the merchant— but the response removes the
 * item from the queue instead of redrawing its row.
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

  // The same as changing it from the list, and on top of that it closes the
  // model's proposal saying whether it got it right.
  await confirmFromReview(id, row, parsed.data.category_id, {
    rememberMerchant: parsed.data.recorda_comerc,
  });

  const toReview = await countToReview(workspace.id);

  return fragment(
    c,
    await withOob(ReviewDone(id), ReviewCounter(toReview, true), toast("Confirmat", "success")),
  );
});
