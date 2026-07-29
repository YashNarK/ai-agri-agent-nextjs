"use client";

// ============================================================
// components/chat/assistant-chat.tsx
//
// The chat surface: CopilotKit provider + chat view, wired to the
// AG-UI agent at /api/copilotkit.
//
// The thread id is generated once per mount and passed explicitly. It
// becomes the LangGraph `thread_id` AND the chat_sessions row id, so
// one identifier ties the checkpointed conversation to the persisted
// transcript — the same thing the REST /api/chat route does with its
// session_id.
// ============================================================

import {
  CopilotChat,
  CopilotKitProvider,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { useState } from "react";

import type { AgentUiState } from "@/agents/agui-agent";
import { toolRenderers } from "@/components/chat/tool-renderers";
import { seriesColor } from "@/components/charts/theme";

import "@copilotkit/react-core/v2/styles.css";

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

export function AssistantChat() {
  // one thread per mount; crypto.randomUUID in a lazy initialiser so it
  // is generated on the client exactly once and never during SSR, where
  // it would differ from the client value and trip hydration
  const [threadId] = useState(() => crypto.randomUUID());

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      renderToolCalls={toolRenderers}
    >
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
          />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
