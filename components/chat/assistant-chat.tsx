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
//
// Returning to a thread replays what is in the DATABASE, not a run in
// progress: a run is bound to the connection that started it and is
// aborted when this component unmounts, so an unfinished turn is lost
// rather than resumed. RunNavigationGuard below exists to keep the user
// here until the turn commits; see its header for why that is a stopgap
// and what replaces it.
// ============================================================

import {
  CopilotChat,
  CopilotChatAssistantMessage,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import type { AgentUiState } from "@/agents/agui-agent";
import { asRunTrace, type RunTrace } from "@/agents/trace";
import { seriesColor } from "@/components/charts/theme";
import { ReasoningAccordion } from "@/components/chat/reasoning-accordion";
import { RunNavigationGuard } from "@/components/chat/run-navigation-guard";
import type { TranscriptResponse } from "@/lib/schemas";

const AGENT_ID = "agricultural";

/**
 * The current run's reasoning trace, live.
 *
 * Reads the same `trace` the bridge streams in STATE_SNAPSHOT and the
 * same shape it persists, so the accordion a user expands mid-run is
 * the one they will still find after a reload.
 *
 * Rendered above the composer rather than threaded into CopilotChat's
 * message list: the message slots receive a rendered message, not the
 * run behind it, so there is no per-message hook to hang this on
 * without forking the component. Replayed turns get their accordion
 * from the transcript instead — see useRestoredTranscript.
 */
function LiveReasoning() {
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const state = agent.state as Partial<AgentUiState> | undefined;
  const steps = state?.trace ?? [];

  if (steps.length === 0) return null;

  return (
    <div className="border-b px-4 py-1">
      <ReasoningAccordion
        trace={{ steps }}
        running={agent.isRunning}
      />
    </div>
  );
}

/**
 * Says out loud that leaving now would cancel the answer.
 *
 * The pairing matters: RunNavigationGuard blocks the ways off the page,
 * and a block with no prior warning reads as the app being broken. This
 * is the warning; the toast is only the reminder for someone who tried
 * anyway.
 *
 * The text collapses to a dot plus "Answering…" on phones, where the
 * header shares one line with the tool-budget readout.
 */
function RunNotice() {
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });

  if (!agent.isRunning) return null;

  return (
    <span
      role="status"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
        aria-hidden
      />
      <span>
        Answering
        <span className="hidden sm:inline"> — stay on this page until it finishes</span>
        <span className="sm:hidden">…</span>
      </span>
    </span>
  );
}

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
/**
 * Traces for REPLAYED turns, keyed by the message id the transcript
 * gave them.
 *
 * A context rather than a prop because the consumer is a slot component
 * CopilotChat instantiates itself — there is no call site to thread a
 * prop through. Empty for a live run, whose accordion is fed from agent
 * state instead.
 */
const ReplayedTraces = createContext<Record<string, RunTrace>>({});

/**
 * Which conversation the shared agent's messages currently belong to.
 *
 * MODULE SCOPE, DELIBERATELY. There is one agent instance for every
 * thread (useAgent keys by agentId alone) and it is owned by the
 * provider in the dashboard LAYOUT, so it outlives this component by
 * design — that is what keeps a streaming answer alive when you glance
 * at another page. A ref or state here is therefore the wrong lifetime:
 * it resets on remount while the agent keeps yesterday's messages, and
 * the mismatch is invisible until you open an old conversation and see
 * the previous one's bubbles.
 *
 * Tying the marker to the agent's lifetime instead means both are reset
 * by the same thing — a full reload — and never disagree.
 */
let agentThread: string | null = null;

/** Stable empty value, so an unrestored thread does not re-render on every pass. */
const NO_TRACES: { thread: string; map: Record<string, RunTrace> } = {
  thread: "",
  map: {},
};

/**
 * The stock assistant message with its run's accordion above it.
 *
 * Wrapping rather than reimplementing: everything CopilotKit renders —
 * markdown, toolbar, tool-call views — is untouched, and this adds one
 * element before it. Live turns get their accordion from LiveReasoning
 * instead, so this stays silent unless the message came from the
 * database.
 */
// Object.assign, not a bare function: the slot is typed as
// `typeof CopilotChatAssistantMessage`, which carries the component's
// static sub-slots (MarkdownRenderer, Toolbar, CopyButton, …). A
// replacement without them is not assignable, and CopilotChat reaches
// for them when rendering. Copying them over keeps the wrapper a
// drop-in.
const AssistantMessageWithTrace = Object.assign(
  function AssistantMessageWithTrace(
    props: React.ComponentProps<typeof CopilotChatAssistantMessage>,
  ) {
    const traces = useContext(ReplayedTraces);
    const id = props.message?.id;
    const trace = id ? traces[id] : undefined;

    return (
      <>
        {trace && <ReasoningAccordion trace={trace} />}
        <CopilotChatAssistantMessage {...props} />
      </>
    );
  },
  CopilotChatAssistantMessage,
);

function useRestoredTranscript(threadId: string) {
  // `useAgent` in this version keys agents by agentId alone — there is no
  // threadId parameter, so this is the same agent instance `<CopilotChat
  // threadId={…}>` runs against, and the thread only matters for which
  // transcript we fetch.
  const { agent } = useAgent({ agentId: AGENT_ID });
  // one restore attempt per thread, even under StrictMode's double effect
  const restoredFor = useRef<string | null>(null);
  // Stamped with the thread they were fetched for, rather than cleared
  // on switch. Clearing would mean a setState in the effect body, which
  // triggers a cascading render; tagging lets the read below simply
  // ignore another conversation's traces until the new ones arrive.
  const [traces, setTraces] = useState<{
    thread: string;
    map: Record<string, RunTrace>;
  }>(NO_TRACES);

  useEffect(() => {
    if (restoredFor.current === threadId) return;

    // Whether the messages the agent is holding belong to a DIFFERENT
    // conversation than the one now in the URL. See agentThread above
    // for why this cannot be answered from component state.
    const stale = agentThread !== null && agentThread !== threadId;
    agentThread = threadId;
    restoredFor.current = threadId;

    // Clear FIRST, synchronously. The transcript fetch below is async,
    // and until it resolves the pane would otherwise keep rendering the
    // previous conversation under the new conversation's URL — which is
    // the visible half of this bug.
    // These are external-system calls on the agent, not React state, so
    // they are exactly what an effect body is for.
    if (stale) {
      agent.setMessages([]);
      // The run state is per-agent too, so the previous conversation's
      // reasoning accordion, artifacts and tool-budget pips would
      // otherwise sit above the new conversation as well.
      agent.setState({});
    }

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
        // A run that started while the fetch was in flight owns the pane
        // — replacing its messages would drop the answer mid-write.
        if (agent.isRunning) return;
        // Only defer to the in-memory transcript when it belongs to THIS
        // conversation, where it is genuinely the fresher copy. When it
        // belongs to another one it is not fresher, it is wrong, and the
        // old guard's `messages.length > 0` could not tell the two apart
        // — so switching conversations silently kept showing the one you
        // had just left.
        if (!stale && agent.messages.length > 0) return;

        // Traces are lifted out BEFORE setMessages: the agent's Message
        // type has no room for them, so anything not extracted here is
        // dropped on the way in and the replayed turns lose their
        // accordions again.
        const restored: Record<string, RunTrace> = {};
        for (const message of transcript.messages) {
          const trace = asRunTrace(message.trace);
          if (trace) restored[message.id] = trace;
        }
        setTraces({ thread: threadId, map: restored });

        // `trace` is stripped before the messages reach the agent. It is
        // OUR field, added to the transcript payload for the accordion,
        // and the agent validates what it is handed against the AG-UI
        // Message shape — an unrecognised key there risks the whole
        // restore being rejected, which surfaces as a conversation that
        // opens completely empty.
        agent.setMessages(
          transcript.messages.map(({ trace: _trace, ...message }) => message),
        );
      } catch (error) {
        // The conversation itself is intact in the checkpointer, so the
        // agent still has context for the next turn even with an
        // empty-looking pane — but an empty pane is exactly what a user
        // reports as "my chat is gone", and swallowing this silently is
        // what made that hard to diagnose. Cosmetic, not invisible.
        console.error("[assistant] transcript restore failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, threadId]);

  // Another conversation's traces are not shown while this one's are
  // still in flight — the accordion would be attached to message ids
  // that are not on screen.
  return traces.thread === threadId ? traces.map : NO_TRACES.map;
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
  const replayedTraces = useRestoredTranscript(threadId);
  useRefreshOnRunEnd();

  return (
    <ReplayedTraces.Provider value={replayedTraces}>
    <div className="flex h-full flex-col">
      <RunNavigationGuard />
      {/* wraps rather than overflowing: on a narrow phone the title, the
          run notice and the budget pips do not fit on one line */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2">
        <span className="text-sm font-medium">Agricultural assistant</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RunNotice />
          <WorkBudget />
        </div>
      </div>
      <LiveReasoning />
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
          // Replaced wholesale rather than configured, so each replayed
          // assistant turn can carry its own reasoning accordion. The
          // stock component still does the rendering — see
          // AssistantMessageWithTrace.
          messageView={{
            assistantMessage: AssistantMessageWithTrace,
          }}
        />
      </div>
    </div>
    </ReplayedTraces.Provider>
  );
}
