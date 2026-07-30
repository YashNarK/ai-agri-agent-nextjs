// ============================================================
// app/dashboard/assistant/page.tsx
//
// The chat page: a conversation switcher beside the chat surface.
//
// The conversation is identified by `?thread=<uuid>` in the URL. That is
// why a conversation survives at all: a value held in React state died
// with the component, whereas the URL survives navigation, reload,
// back/forward and a shared link — and it makes switching threads plain
// navigation rather than client state. A visit without one is redirected
// to a freshly minted thread, so the address bar always names the
// conversation on screen.
// ============================================================

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { AssistantChat } from "@/components/chat/assistant-chat";
import { requireApproved } from "@/lib/auth/guard";
import { chatService } from "@/lib/container";

import { ConversationList } from "./conversation-list";

export const metadata = {
  title: "Assistant — Agricultural Intelligence",
};

export const dynamic = "force-dynamic";

/** Anything that is not a plausible thread id gets replaced rather than trusted. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  // Ahead of the thread redirect below, so an unapproved visitor is not
  // handed a freshly minted conversation id they can never use.
  const viewer = await requireApproved("/dashboard/assistant");

  const { thread } = await searchParams;

  // The id reaches Postgres as a uuid column and LangGraph as a thread
  // key, so validating the shape here keeps a hand-edited URL from
  // becoming a database error further down.
  if (!thread || !UUID_PATTERN.test(thread)) {
    redirect(`/dashboard/assistant?thread=${randomUUID()}`);
  }

  const conversations = await chatService.listConversations(viewer.id);

  // A well-formed id that belongs to someone else must not even render.
  // The agent refuses it too, but only once a message is sent — by then
  // the user is staring at what looks like a working empty chat.
  const foreign =
    !conversations.some((conversation) => conversation.id === thread) &&
    !(await chatService.canUseThread(thread, viewer.id));
  if (foreign) {
    redirect(`/dashboard/assistant?thread=${randomUUID()}`);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[88rem] flex-col px-6 py-6">
      <header className="mb-4 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Asks the same database the dashboard reads. Every figure it quotes
          comes from a tool call shown inline — nothing is recalled from the
          model&apos;s memory.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[260px_1fr]">
        <aside className="hidden min-h-0 rounded-xl border p-3 md:block">
          <ConversationList
            conversations={conversations}
            activeThreadId={thread}
          />
        </aside>

        <div className="min-h-0 overflow-hidden rounded-xl border">
          <AssistantChat threadId={thread} />
        </div>
      </div>
    </div>
  );
}
