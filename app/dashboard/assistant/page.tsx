// ============================================================
// app/dashboard/assistant/page.tsx
//
// The chat page. A thin server shell around the client chat surface —
// there is nothing to fetch here, because every number in the transcript
// comes from a tool call the agent makes at run time.
//
// The conversation is identified by `?thread=<uuid>` in the URL. That is
// the whole reason a conversation survives now: a value held in React
// state died with the component, whereas the URL survives navigation,
// reload, back/forward and a shared link. A visit without one is
// redirected to a freshly minted thread, so the address bar always names
// the conversation on screen.
// ============================================================

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { AssistantChat } from "@/components/chat/assistant-chat";

export const metadata = {
  title: "Assistant — Agricultural Intelligence",
};

/** Anything that is not a plausible thread id gets replaced rather than trusted. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;

  // The id reaches Postgres as a uuid column and LangGraph as a thread
  // key, so validating the shape here keeps a hand-edited URL from
  // becoming a database error further down.
  if (!thread || !UUID_PATTERN.test(thread)) {
    redirect(`/dashboard/assistant?thread=${randomUUID()}`);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-4xl flex-col px-6 py-6">
      <header className="mb-4 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Asks the same database the dashboard reads. Every figure it quotes
          comes from a tool call shown inline — nothing is recalled from the
          model&apos;s memory.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border">
        <AssistantChat threadId={thread} />
      </div>
    </div>
  );
}
