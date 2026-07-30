"use client";

// ============================================================
// components/chat/assistant-chat.tsx
//
// The chat surface: the chat view plus the work-budget readout, wired to
// the AG-UI agent at /api/copilotkit. The provider itself is mounted by
// the dashboard layout, not here.
//
// The thread id arrives as a prop, resolved from the URL by the page. It
// becomes the LangGraph `thread_id` AND the chat_sessions row id, so one
// identifier ties the checkpointed conversation to the persisted
// transcript — the same thing the REST /api/chat route does with its
// session_id. It used to be minted per mount, which meant leaving the
// page and coming back silently started a different conversation.
// ============================================================

import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import type { AgentUiState } from "@/agents/agui-agent";
import { seriesColor } from "@/components/charts/theme";
import type { TranscriptResponse } from "@/lib/schemas";

const AGENT_ID = "agricultural";

/**
 * Shows how much of the agent's per-turn tool budget this turn has used.
 *
 * This is not decoration. The agent is instructed to narrow broad
 * questions rather than answer them shallowly, and when it stops early
 * that looks like laziness unless the constraint is visible. Rendered
 * only once a turn has actually used something.
 */
function WorkBudget() {
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [UseAgentUpdate.OnStateChanged],
  });
  const state = agent.state as Partial<AgentUiState> | undefined;
  const used = state?.toolCallsUsed ?? 0;
  const budget = state?.toolCallBudget ?? 0;

  if (used === 0 || budget === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {used}/{budget} tool calls
      </span>
      <span className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: budget }, (_, index) => (
          <span
            key={index}
            className="h-1.5 w-3 rounded-full"
            style={{
              background: index < used ? seriesColor(0) : "var(--muted)",
            }}
          />
        ))}
      </span>
      {state?.budgetExhausted && (
        <span>— budget reached, answering with what it gathered</span>
      )}
    </div>
  );
}

/**
 * Restores the persisted transcript into the agent after a full reload.
 *
 * Only runs when the agent has no messages of its own. Within a session
 * the layout-level provider keeps the agent alive across navigation, so
 * the in-memory transcript is already the fresher of the two — and it
 * includes the turn currently streaming, which the database does not
 * have until the run finishes. Overwriting that with the persisted copy
 * would delete an answer as it was being written.
 *
 * A run in flight is also a reason to stay out of the way: setMessages
 * mid-stream would drop the partial answer the run is appending to.
 */
function useRestoredTranscript(threadId: string) {
  // `useAgent` in this version keys agents by agentId alone — there is no
  // threadId parameter, so this is the same agent instance `<CopilotChat
  // threadId={…}>` runs against, and the thread only matters for which
  // transcript we fetch.
  const { agent } = useAgent({ agentId: AGENT_ID });
  // one restore attempt per thread, even under StrictMode's double effect
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    if (restoredFor.current === threadId) return;
    restoredFor.current = threadId;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/chat/sessions/${encodeURIComponent(threadId)}/messages`,
        );
        if (!response.ok) return;

        const transcript = (await response.json()) as TranscriptResponse;
        if (cancelled) return;
        if (transcript.messages.length === 0) return;
        // re-checked here, not just above: the fetch is async, and a run
        // may have started while it was in flight
        if (agent.messages.length > 0 || agent.isRunning) return;

        agent.setMessages(transcript.messages);
      } catch {
        // a failed restore is a cosmetic loss — the conversation itself
        // is intact in the checkpointer, so the agent still has context
        // for the next turn even with an empty-looking pane
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, threadId]);
}

/**
 * Refreshes the server-rendered conversation list when a run finishes.
 *
 * A brand-new conversation only becomes a row in the switcher once its
 * first turn is persisted, which happens server-side at the end of the
 * run. Without this the sidebar stays empty until the next navigation,
 * so the conversation you are actively having appears to be missing
 * from the list of your conversations.
 *
 * Watches isRunning for a true→false edge rather than refreshing on
 * every status change, so an idle page does not re-fetch.
 */
function useRefreshOnRunEnd() {
  const router = useRouter();
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const wasRunning = useRef(false);

  useEffect(() => {
    if (wasRunning.current && !agent.isRunning) {
      router.refresh();
    }
    wasRunning.current = agent.isRunning;
  }, [agent.isRunning, router]);
}

export function AssistantChat({ threadId }: { threadId: string }) {
  useRestoredTranscript(threadId);
  useRefreshOnRunEnd();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">Agricultural assistant</span>
        <WorkBudget />
      </div>
      <div className="min-h-0 flex-1">
        <CopilotChat
          agentId={AGENT_ID}
          threadId={threadId}
          labels={{
            chatInputPlaceholder:
              "Ask about prices, forecasts, weather or agronomy…",
          }}
          // The composer renders an "add" (+) button by default, which
          // opens the attachment/tools menu. Attachments are opt-in via
          // an `attachments` prop we never pass, and we register no tools
          // menu — so the button opened nothing. A control that does
          // nothing is worse than no control: it reads as broken rather
          // than absent. `input` is a slot, so overriding this one child
          // leaves the rest of the composer untouched.
          //
          // `sendButton` gets an accessible name for the same reason it
          // needed finding: it ships as a bare icon, so axe flags it
          // "button-name" (critical) and a screen reader announces only
          // "button". Slots accept partial props, so naming it is a
          // one-line override rather than a fork of the component.
          input={{
            addMenuButton: () => null,
            sendButton: { "aria-label": "Send message" },
          }}
          // Same treatment for the per-message actions.
          messageView={{
            assistantMessage: {
              copyButton: { "aria-label": "Copy this reply" },
            },
          }}
        />
      </div>
    </div>
  );
}
