/**
 * Page of the chat resource.
 *
 * `GET <base>` and `GET <base>/:id` **always** return a whole page. The shell
 * (sidebar, workspace picker and counters) is put there by the caller, with
 * `workspacePage()`.
 */

import { html } from "hono/html";

import type { Html } from "../../lib/html.ts";
import type { ConversationSummary } from "../../services/chat.ts";
import { Conversation, ConversationList, type ConversationProps } from "./chat.fragment.ts";

export function ChatPage({
  conversations,
  ...props
}: ConversationProps & { conversations: ConversationSummary[] }): Html {
  const { code, conversationId } = props;
  return html`
    <header class="capçalera">
      <div class="capçalera-fila">
        <h1>Xat</h1>
        ${
          conversationId === null
            ? ""
            : html`<div class="capçalera-accions">
              <button
                type="button"
                class="boto boto-discret"
                hx-post="/e/${code}/xat/${String(conversationId)}/esborra"
                hx-confirm="Esborrar aquesta conversa? Els canvis que ja hagis aplicat es queden."
              >
                Esborra la conversa
              </button>
            </div>`
        }
      </div>
    </header>

    <div class="xat">
      ${ConversationList({ code, conversations, current: conversationId })}
      ${Conversation(props)}
    </div>
  ` as Html;
}
