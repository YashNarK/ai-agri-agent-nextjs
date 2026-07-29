// ============================================================
// agents/agui-agent.ts
//
// Bridges the in-process LangGraph agent to the AG-UI protocol.
//
// WHY HAND-WRITTEN, GIVEN @ag-ui/langgraph EXISTS
//
// A JS package DOES exist — the planning note that AG-UI's LangGraph
// integration is Python-only is out of date. It is still the wrong tool
// here: `LangGraphAgent` takes a `deploymentUrl` and drives a hosted
// LangGraph Platform deployment through @langchain/langgraph-sdk. Our
// graph is compiled inside this Next.js process and there is no
// deployment to point at, so every call it makes would be an HTTP
// request to a server we do not run.
//
// So this subclasses AbstractAgent directly, calls getAgentGraph() in
// process, and translates LangGraph's streamEvents output into AG-UI
// events. No network hop, no second copy of the agent.
//
// THE PROTOCOL RULE THAT SHAPES THIS FILE
//
// AG-UI streams are strictly bracketed: TEXT_MESSAGE_START must be
// closed by TEXT_MESSAGE_END before anything else claims the stream,
// and likewise TOOL_CALL_START → TOOL_CALL_END. A ReAct model emits
// prose and then tool calls inside a single assistant turn, so the open
// text message has to be closed the moment a tool starts. Everything
// tracked in `openTextMessageId` exists to keep that bracketing honest;
// an unclosed message leaves the client spinning forever.
// ============================================================

import { AbstractAgent } from "@ag-ui/client";
import {
  EventType,
  type BaseEvent,
  type CustomEvent,
  type Message,
  type RunAgentInput,
  type RunErrorEvent,
  type RunFinishedEvent,
  type RunStartedEvent,
  type StateSnapshotEvent,
  type StepFinishedEvent,
  type StepStartedEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type TextMessageStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from "@ag-ui/core";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { GraphRecursionError } from "@langchain/langgraph";
import { Observable } from "rxjs";

import { asToolArtifact, type ToolArtifact } from "@/agents/artifacts";
import { getAgentGraph } from "@/agents/graph";
import { MAX_AGENT_TOOL_CALLS, RECURSION_LIMIT } from "@/agents/nodes";
import { chatService } from "@/lib/container";
import { chunkText } from "@/services/chat.service";

/**
 * Agent state mirrored to the client.
 *
 * `artifacts` is keyed by tool-call id because that is the only handle
 * a tool-call renderer is given. TOOL_CALL_RESULT carries a string, so
 * the structured payload cannot ride along with it — it travels here
 * instead and the renderer looks itself up by id.
 */
export interface AgentUiState {
  artifacts: Record<string, ToolArtifact>;
  toolCallsUsed: number;
  toolCallBudget: number;
  budgetExhausted: boolean;
  [key: string]: unknown;
}

function emptyState(): AgentUiState {
  return {
    artifacts: {},
    toolCallsUsed: 0,
    toolCallBudget: MAX_AGENT_TOOL_CALLS,
    budgetExhausted: false,
  };
}

/** Text of the most recent user message in an AG-UI message list. */
function latestUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user") {
      return typeof message.content === "string" ? message.content : "";
    }
  }
  return "";
}

/**
 * Rebuilds LangChain history from the client's message list.
 *
 * Only used when the graph's checkpoint for this thread is empty. The
 * checkpointer is a MemorySaver, so a server restart wipes history the
 * browser still has; without this the agent would answer a follow-up
 * with no idea what came before, which reads as amnesia rather than as
 * the restart it actually is. Tool messages are deliberately dropped —
 * replaying them without their originating tool_calls would produce an
 * invalid message sequence.
 */
function seedHistory(messages: Message[]): BaseMessage[] {
  const history: BaseMessage[] = [];
  // exclude the final user message; it is passed separately as the turn
  const upToLastUser = messages.slice(0, -1);
  for (const message of upToLastUser) {
    if (message.role === "user" && typeof message.content === "string") {
      history.push(new HumanMessage(message.content));
    } else if (
      message.role === "assistant" &&
      typeof message.content === "string" &&
      message.content.trim() !== ""
    ) {
      history.push(new AIMessage(message.content));
    }
  }
  return history;
}

/**
 * Exactly the events this bridge emits.
 *
 * Typed as a union rather than the base `BaseEvent` so each literal
 * below is checked against its own schema — `BaseEvent` (or an `as`
 * assertion) would happily accept an event missing a required field and
 * fail only at runtime, inside a stream, as a hang.
 */
type EmittedEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StateSnapshotEvent
  | StepStartedEvent
  | StepFinishedEvent
  | CustomEvent;

export interface AgriculturalAgentOptions {
  /** Correlates the AG-UI thread with a row in chat_sessions. */
  userId?: string | null;
}

export class AgriculturalAgent extends AbstractAgent {
  private readonly userId: string | null;

  constructor(options: AgriculturalAgentOptions = {}) {
    super({
      agentId: "agricultural",
      description:
        "Agricultural intelligence agent — prices, forecasts, weather and agronomy.",
    });
    this.userId = options.userId ?? null;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      // AbortController, not a boolean flag: an unsubscribed stream (the
      // user navigated away mid-answer) must actually stop the graph,
      // otherwise the Azure calls keep running and keep costing money.
      const abort = new AbortController();

      void this.stream(input, (event) => subscriber.next(event), abort.signal)
        .then(() => subscriber.complete())
        .catch((error: unknown) => {
          // surfaced as a protocol event rather than an Observable error
          // so the client shows a failed run instead of a dead stream
          subscriber.next({
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          subscriber.complete();
        });

      return () => abort.abort();
    });
  }

  private async stream(
    input: RunAgentInput,
    emit: (event: EmittedEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const { threadId, runId } = input;
    const userMessage = latestUserText(input.messages);

    emit({ type: EventType.RUN_STARTED, threadId, runId });

    // the AG-UI thread IS the chat session, so the existing session and
    // message tables stay the source of truth for both entry points
    await chatService.ensureSession(threadId, this.userId);

    const graph = await getAgentGraph();
    const config = {
      configurable: { thread_id: threadId },
      recursionLimit: RECURSION_LIMIT,
      signal,
    };

    // resume from the checkpointer when it has this thread; fall back to
    // the client's transcript when the process has restarted since
    const snapshot = await graph.getState(config);
    const checkpointed = (snapshot.values?.messages ?? []) as BaseMessage[];
    const turn =
      checkpointed.length > 0
        ? [new HumanMessage(userMessage)]
        : [...seedHistory(input.messages), new HumanMessage(userMessage)];

    const state = emptyState();
    let openTextMessageId: string | null = null;
    /**
     * One entry per assistant message, in order.
     *
     * Kept as segments rather than one concatenated string so the answer
     * persisted here matches what the REST route persists. A ReAct turn
     * emits a preamble ("I'll check the available crops…") as its own
     * assistant message before the tool call; concatenating would file
     * that preamble as part of the answer, and the same conversation
     * would then read differently depending on which entry point wrote
     * it. extractFinalAiMessage() takes the LAST non-empty assistant
     * message, so this does too.
     */
    const segments: string[] = [];
    const toolNames: string[] = [];
    /** LangChain run_id → the tool-call id we advertised to the client. */
    const openToolCalls = new Map<string, string>();

    const closeText = () => {
      if (openTextMessageId === null) return;
      emit({
        type: EventType.TEXT_MESSAGE_END,
        messageId: openTextMessageId,
      });
      openTextMessageId = null;
    };

    const pushState = () => {
      emit({
        type: EventType.STATE_SNAPSHOT,
        snapshot: { ...state, artifacts: { ...state.artifacts } },
      });
    };

    try {
      const events = graph.streamEvents({ messages: turn }, {
        ...config,
        version: "v2",
      });

      for await (const event of events) {
        if (signal.aborted) break;

        switch (event.event) {
          case "on_chat_model_stream": {
            const text = chunkText(
              (event.data?.chunk as { content?: unknown } | undefined)?.content,
            );
            // tool-call argument deltas arrive as chunks with empty
            // content; emitting a text message for them would open a
            // bracket that never carries anything
            if (text === "") break;
            if (openTextMessageId === null) {
              openTextMessageId = `${runId}-msg-${event.run_id}`;
              segments.push("");
              emit({
                type: EventType.TEXT_MESSAGE_START,
                messageId: openTextMessageId,
                role: "assistant",
              });
            }
            segments[segments.length - 1] += text;
            emit({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId: openTextMessageId,
              delta: text,
            });
            break;
          }

          case "on_tool_start": {
            // a tool interrupts any assistant prose mid-turn, so the
            // open text bracket has to close before the tool's opens
            closeText();
            const toolCallId = `${runId}-tool-${event.run_id}`;
            openToolCalls.set(event.run_id, toolCallId);
            toolNames.push(event.name);
            state.toolCallsUsed += 1;

            emit({
              type: EventType.TOOL_CALL_START,
              toolCallId,
              toolCallName: event.name,
            });
            emit({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId,
              delta: JSON.stringify(event.data?.input ?? {}),
            });
            emit({ type: EventType.TOOL_CALL_END, toolCallId });
            break;
          }

          case "on_tool_end": {
            const toolCallId = openToolCalls.get(event.run_id);
            if (!toolCallId) break;
            openToolCalls.delete(event.run_id);

            const output = event.data?.output as
              | { content?: unknown; artifact?: unknown }
              | undefined;

            emit({
              type: EventType.TOOL_CALL_RESULT,
              messageId: `${toolCallId}-result`,
              toolCallId,
              content: chunkText(output?.content),
              role: "tool",
            });

            // the structured payload the tool produced alongside its
            // prose; absent on error and no-data paths, where the
            // renderer falls back to showing the text
            const artifact = asToolArtifact(output?.artifact);
            if (artifact) {
              state.artifacts[toolCallId] = artifact;
            }
            pushState();
            break;
          }

          case "on_chain_start":
          case "on_chain_end": {
            // only the two graph nodes, not every internal runnable
            if (event.name !== "llm" && event.name !== "tools") break;
            // two literals rather than one with a ternary `type`: the
            // discriminant has to be a literal for the union to narrow
            if (event.event === "on_chain_start") {
              emit({ type: EventType.STEP_STARTED, stepName: event.name });
            } else {
              emit({ type: EventType.STEP_FINISHED, stepName: event.name });
            }
            break;
          }

          default:
            break;
        }

        // announced as soon as it is true, so the UI can explain the
        // narrowed scope while the final answer is still streaming
        if (
          !state.budgetExhausted &&
          state.toolCallsUsed >= MAX_AGENT_TOOL_CALLS
        ) {
          state.budgetExhausted = true;
          emit({
            type: EventType.CUSTOM,
            name: "tool_budget_exhausted",
            value: { used: state.toolCallsUsed, budget: MAX_AGENT_TOOL_CALLS },
          });
          pushState();
        }
      }
    } catch (error) {
      if (!(error instanceof GraphRecursionError)) throw error;
      // the in-graph budget normally stops the loop long before this;
      // reaching it means answering with whatever was gathered beats
      // failing the run outright
      segments.push(
        "I ran out of reasoning steps before finishing. Please narrow the " +
          "question and I'll complete it.",
      );
    }

    closeText();

    // last non-empty segment, matching extractFinalAiMessage()
    const answer = [...segments].reverse().find((s) => s.trim() !== "") ?? "";

    if (answer !== "" && !signal.aborted) {
      await chatService.persistStreamedTurn(
        threadId,
        userMessage,
        answer,
        toolNames,
      );
    }

    emit({
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
    });
  }
}
