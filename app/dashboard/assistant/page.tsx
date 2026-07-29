// ============================================================
// app/dashboard/assistant/page.tsx
//
// The chat page. A thin server shell around the client chat surface —
// there is nothing to fetch here, because every number in the transcript
// comes from a tool call the agent makes at run time.
// ============================================================

import { AssistantChat } from "@/components/chat/assistant-chat";

export const metadata = {
  title: "Assistant — Agricultural Intelligence",
};

export default function AssistantPage() {
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
        <AssistantChat />
      </div>
    </div>
  );
}
