/**
 * Routes of the chat resource.
 *
 * GET  /xat                                → page: a new conversation.
 * POST /xat                                → starts one; redirects to it.
 * GET  /xat/:id                            → page: that conversation.
 * POST /xat/:id/missatges                  → asks; returns the conversation.
 * GET  /xat/:id/fragment/missatge/:m       → one answer, polled while pending.
 * POST /xat/:id/esborra                    → deletes the conversation.
 * POST /xat/accions/:id/aplica             → applies a proposal (editors).
 * POST /xat/accions/:id/desfes             → undoes the last one (editors).
 *
 * Conversations are private: every lookup takes the user, and somebody else's
 * conversation is a 404 like one that does not exist.
 */

import type { Context } from "hono";
import { Hono } from "hono";

import { zodErrors } from "../../components/form.ts";
import { ReviewCounter } from "../../components/layout.ts";
import { workspacePage } from "../../components/workspace-page.ts";
import { roleAtLeast } from "../../db/schema/index.ts";
import { config } from "../../lib/config.ts";
import {
  ConflictError,
  fragment,
  idFromRoute,
  page,
  redirect,
  toast,
  withOob,
} from "../../lib/http.ts";
import { attemptFromQuery, ATTEMPT_PARAM } from "../../lib/polling.ts";
import { currentUser } from "../../middleware/session.ts";
import { currentRole, currentWorkspace, requireEditor } from "../../middleware/workspace.ts";
import {
  actionsOfConversation,
  actionView,
  applyAction,
  movementsText,
  undoAction,
} from "../../services/chat-actions.ts";
import {
  askInConversation,
  conversationOf,
  deleteConversation,
  enqueueAnswer,
  listConversations,
  messageOf,
  messagesOf,
  startConversation,
} from "../../services/chat.ts";
import { countToReview } from "../../services/counters.ts";
import { ActionCard, Conversation, Message, type ConversationProps } from "./chat.fragment.ts";
import { ChatPage } from "./chat.page.ts";
import { questionSchema } from "./chat.schema.ts";

export const chatRoutes = new Hono();

function who(c: Context) {
  const workspace = currentWorkspace(c);
  return {
    workspace,
    userId: currentUser(c).id,
    canEdit: roleAtLeast(currentRole(c), "editor"),
  };
}

function requireModel(): void {
  if (!config.ollamaEnabled) {
    throw new ConflictError("El model local no està activat en aquesta instal·lació");
  }
}

async function conversationProps(
  c: Context,
  conversationId: number,
  extra: Partial<ConversationProps> = {},
): Promise<ConversationProps> {
  const { workspace, canEdit } = who(c);
  const [messages, actions] = await Promise.all([
    messagesOf(conversationId),
    actionsOfConversation(conversationId, workspace.id),
  ]);
  return {
    code: workspace.code,
    conversationId,
    messages,
    actions,
    canEdit,
    enabled: config.ollamaEnabled,
    ...extra,
  };
}

// --- Pages -----------------------------------------------------------------

chatRoutes.get("/", async (c) => {
  const { workspace, userId, canEdit } = who(c);
  const conversations = await listConversations(workspace.id, userId);
  return page(
    c,
    await workspacePage(
      c,
      "Xat",
      ChatPage({
        code: workspace.code,
        conversationId: null,
        conversations,
        messages: [],
        actions: new Map(),
        canEdit,
        enabled: config.ollamaEnabled,
      }),
    ),
  );
});

chatRoutes.get("/:id", async (c) => {
  const { workspace, userId } = who(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta conversa no existeix");
  const conversation = await conversationOf(id, workspace.id, userId);
  const [conversations, props] = await Promise.all([
    listConversations(workspace.id, userId),
    conversationProps(c, id),
  ]);
  return page(
    c,
    await workspacePage(c, conversation.title, ChatPage({ ...props, conversations })),
  );
});

// --- Asking ----------------------------------------------------------------

chatRoutes.post("/", async (c) => {
  const { workspace, userId, canEdit } = who(c);
  requireModel();

  const body = await c.req.parseBody();
  const parsed = questionSchema.safeParse(body);
  if (!parsed.success) {
    return fragment(
      c,
      Conversation({
        code: workspace.code,
        conversationId: null,
        messages: [],
        actions: new Map(),
        canEdit,
        enabled: true,
        question: typeof body.pregunta === "string" ? body.pregunta : "",
        errors: zodErrors(parsed.error),
      }),
      422,
    );
  }

  const { conversationId, answerId } = await startConversation(
    workspace.id,
    userId,
    parsed.data.pregunta,
  );
  void enqueueAnswer(answerId);
  return redirect(c, `/e/${workspace.code}/xat/${conversationId}`);
});

chatRoutes.post("/:id/missatges", async (c) => {
  const { workspace, userId } = who(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta conversa no existeix");
  await conversationOf(id, workspace.id, userId);
  requireModel();

  const body = await c.req.parseBody();
  const parsed = questionSchema.safeParse(body);
  if (!parsed.success) {
    return fragment(
      c,
      Conversation(
        await conversationProps(c, id, {
          question: typeof body.pregunta === "string" ? body.pregunta : "",
          errors: zodErrors(parsed.error),
        }),
      ),
      422,
    );
  }

  const answerId = await askInConversation(id, parsed.data.pregunta);
  void enqueueAnswer(answerId);
  return fragment(c, Conversation(await conversationProps(c, id)));
});

/** One answer. While it is pending the fragment carries its own bounded poll. */
chatRoutes.get("/:id/fragment/missatge/:missatge", async (c) => {
  const { workspace, userId, canEdit } = who(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta conversa no existeix");
  const messageId = idFromRoute(c.req.param("missatge"), "Aquest missatge no existeix");
  await conversationOf(id, workspace.id, userId);
  const message = await messageOf(messageId, id);
  const actions = await actionsOfConversation(id, workspace.id);

  return fragment(
    c,
    Message({
      code: workspace.code,
      conversationId: id,
      message,
      actions,
      canEdit,
      attempt: attemptFromQuery(c.req.query(ATTEMPT_PARAM)),
    }),
  );
});

chatRoutes.post("/:id/esborra", async (c) => {
  const { workspace, userId } = who(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta conversa no existeix");
  await deleteConversation(id, workspace.id, userId);
  return redirect(c, `/e/${workspace.code}/xat`);
});

// --- Proposals -------------------------------------------------------------

/**
 * Applying or undoing changes categories and review flags, so the sidebar's
 * review counter goes along, out of band.
 */
async function actionResponse(c: Context, actionId: number, message: string) {
  const { workspace, userId, canEdit } = who(c);
  const [action, toReview] = await Promise.all([
    actionView(actionId, workspace.id, userId),
    countToReview(workspace.id),
  ]);
  return fragment(
    c,
    await withOob(
      ActionCard({ code: workspace.code, action, canEdit }),
      ReviewCounter(toReview, true),
      toast(message, "success"),
    ),
  );
}

chatRoutes.post("/accions/:id/aplica", requireEditor, async (c) => {
  const { workspace, userId } = who(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta proposta no existeix");
  const { changed } = await applyAction(id, workspace.id, userId);
  return actionResponse(c, id, `Aplicat: ${movementsText(changed)} canviats.`);
});

chatRoutes.post("/accions/:id/desfes", requireEditor, async (c) => {
  const { workspace, userId } = who(c);
  const id = idFromRoute(c.req.param("id"), "Aquesta proposta no existeix");
  const { restored, skipped } = await undoAction(id, workspace.id, userId);
  return actionResponse(
    c,
    id,
    skipped > 0
      ? `Desfet: ${movementsText(restored)} restaurats. ${movementsText(skipped)} s'havien tornat a tocar i s'han deixat com estaven.`
      : `Desfet: ${movementsText(restored)} restaurats.`,
  );
});
