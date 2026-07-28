// ============================================================
// agents/state.ts
//
// LangGraph agent state definition.
//
// Annotation.Root defines the shape of state passed between graph
// nodes: every node receives the full state and returns updates,
// which LangGraph merges using each channel's reducer.
//
// messagesStateReducer:
//   the message-list reducer — appends new messages (and replaces
//   ones with a matching id) rather than overwriting the list.
//   This is how conversation history accumulates.
//
// Port of agents/state.py
// ============================================================

import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  session_id: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  retrieved_docs: Annotation<Record<string, unknown>[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  prediction_data: Annotation<Record<string, unknown> | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  tool_calls_made: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  user_id: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
