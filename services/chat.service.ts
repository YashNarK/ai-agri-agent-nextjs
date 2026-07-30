// ============================================================
// services/chat.service.ts
//
// Chat orchestration: session bootstrap, LangGraph invocation,
// answer extraction and persistence.
//
// The Python version kept this inline in routers/chat.py; pulling it
// into a service keeps the two route handlers (/chat and /chatstream)
// thin and lets them share the extraction logic.
//
// Port of routers/chat.py
// ============================================================

import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { GraphRecursionError } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";

import { getAgentGraph } from "@/agents/graph";
import { isAiMessage, RECURSION_LIMIT } from "@/agents/nodes";
import { notFound } from "@/lib/errors";
import type {
  ChatResponse,
  MessageResponse,
  SessionSchema,
  ToolCallRecord,
  TranscriptMessage,
  TranscriptResponse,
} from "@/lib/schemas";
import type { ChatRepository } from "@/repositories/chat.repository";

export const BUDGET_FALLBACK =
  "I couldn't finish this request within my work budget for a single turn. " +
  "Please narrow it — e.g. focus on one region or a few specific crops — and " +
  "I'll complete it.";

/**
 * Extracts plain text from a streamed message chunk, tolerating both the
 * string and structured (content-block list) shapes LangChain may emit.
 */
export function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") return b.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Walks the message list in reverse to find the last AIMessage with real
 * non-empty content.
 *
 * Why not just messages[messages.length - 1]?
 *   In a ReAct loop the graph emits intermediate AIMessages like
 *   "Let me check the market indicators..." before tool calls — these have
 *   empty or partial content and are NOT the final answer. This skips
 *   those and returns the last AIMessage that actually contains one.
 */
export function extractFinalAiMessage(
  messages: BaseMessage[],
): BaseMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    // isAiMessage, not `instanceof AIMessage`: streaming aggregation
    // yields AIMessageChunk, which does not extend AIMessage, so
    // instanceof would skip the real answer and fall through to the
    // last message — usually the model's "let me check…" preamble.
    if (isAiMessage(msg) && chunkText(msg.content).trim() !== "") {
      return msg;
    }
  }
  // fallback — should never be reached if the graph is healthy
  return messages[messages.length - 1];
}

/**
 * Collects ALL tool calls made across the entire reasoning loop — not just
 * from the last message.
 *
 * A multi-step ReAct agent may call several tools across multiple hops
 * before answering. The final AIMessage has no tool_calls (it's the
 * answer), so looking only there would always report none.
 */
export function collectAllToolCalls(
  messages: BaseMessage[],
): ToolCallRecord[] | null {
  const all: ToolCallRecord[] = [];
  for (const msg of messages) {
    if (!isAiMessage(msg)) continue;
    for (const tc of (msg as AIMessage).tool_calls ?? []) {
      all.push({ name: tc.name, args: tc.args });
    }
  }
  return all.length > 0 ? all : null;
}

export interface ChatTurnInput {
  message: string;
  sessionId?: string | null;
  userId?: string | null;
}

export class ChatService {
  constructor(private readonly chatRepo: ChatRepository) {}

  /** Creates the session if it does not exist and returns its id. */
  async ensureSession(
    sessionId: string | null | undefined,
    userId: string | null | undefined,
  ): Promise<string> {
    const id = sessionId || randomUUID();
    await this.chatRepo.ensureSession(id, userId);
    return id;
  }

  /**
   * Non-streaming turn: invoke the agent, extract the real final answer,
   * collect every tool call, persist both messages, return the response.
   */
  async chat({ message, sessionId, userId }: ChatTurnInput): Promise<ChatResponse> {
    const id = await this.ensureSession(sessionId, userId);
    const graph = await getAgentGraph();

    // thread_id enables per-session memory; the graph internally loops
    // llm → tools → llm → ... → llm(final). recursion_limit is a hard
    // backstop — the in-graph tool-call budget normally stops the loop
    // long before it is reached.
    const agentConfig = {
      configurable: { thread_id: id },
      recursionLimit: RECURSION_LIMIT,
    };

    let allMessages: BaseMessage[];
    try {
      const result = await graph.invoke(
        { messages: [new HumanMessage(message)] },
        agentConfig,
      );
      allMessages = result.messages;
    } catch (error) {
      if (!(error instanceof GraphRecursionError)) throw error;
      // extremely defensive: recover whatever the agent produced so far
      // and return it gracefully instead of surfacing a 500 mid-demo
      const snapshot = await graph.getState(agentConfig);
      allMessages = (snapshot.values?.messages ?? []) as BaseMessage[];
    }

    const lastMessage =
      allMessages.length > 0 ? extractFinalAiMessage(allMessages) : undefined;
    const responseText =
      (lastMessage ? chunkText(lastMessage.content) : "") || BUDGET_FALLBACK;

    const toolCalls = collectAllToolCalls(allMessages);

    await this.chatRepo.persistTurn({
      sessionId: id,
      userMessage: message,
      aiMessage: responseText,
      toolCalls,
      langgraphState: { message_count: allMessages.length },
    });

    return { session_id: id, message: responseText, tool_calls: toolCalls };
  }

  /** Persists one streamed turn once the SSE generator has finished. */
  async persistStreamedTurn(
    sessionId: string,
    userMessage: string,
    finalText: string,
    toolNames: string[],
  ): Promise<void> {
    await this.chatRepo.persistTurn({
      sessionId,
      userMessage,
      aiMessage: finalText,
      toolCalls: toolNames.length > 0 ? toolNames.map((name) => ({ name })) : null,
    });
  }

  /**
   * The persisted transcript for a session, for rehydrating the chat UI
   * after a reload.
   *
   * Deliberately tolerant of an unknown session: a thread id in the URL
   * that has never been used is the normal first-visit case, not an error,
   * and returning an empty transcript lets the client treat both the same.
   *
   * Only human and AI turns are replayed. Tool calls are persisted too,
   * but their inline renderings belong to a live run — replaying them from
   * a transcript would show chart cards with no run behind them.
   */
  async getTranscript(
    sessionId: string,
    viewerId: string,
  ): Promise<TranscriptResponse> {
    // Ownership, not just existence. The thread id is a UUID in the URL,
    // which is unguessable but not secret — it survives in history, in
    // shared links and in logs — so it cannot be the only thing standing
    // between one user and another user's conversation.
    //
    // An existing session owned by somebody else is reported as empty
    // rather than 403: a distinct error would confirm that the id names
    // a real conversation, which is exactly what a prober wants to know.
    const session = await this.chatRepo.findSession(sessionId);
    if (session && session.user_id !== viewerId) {
      return { session_id: sessionId, messages: [] };
    }

    const rows = await this.chatRepo.listMessages(sessionId);

    const messages: TranscriptMessage[] = rows
      .filter((row) => row.role === "human" || row.role === "ai")
      .map((row) => ({
        id: String(row.id),
        role: row.role === "human" ? ("user" as const) : ("assistant" as const),
        content: row.content,
      }));

    return { session_id: sessionId, messages };
  }

  async getSession(sessionId: string): Promise<SessionSchema> {
    const session = await this.chatRepo.findSession(sessionId);
    if (!session) {
      throw notFound(`Session ${sessionId} not found`);
    }
    return {
      id: session.id,
      user_id: session.user_id,
      session_name: session.session_name,
      created_at: session.created_at.toISOString(),
    };
  }

  /**
   * Idempotent delete: a missing session returns 200 with a graceful
   * message rather than 404, so cleanup jobs can call it blindly.
   */
  async deleteSession(sessionId: string): Promise<MessageResponse> {
    const session = await this.chatRepo.findSession(sessionId);
    if (!session) {
      return { message: `Session ${sessionId} already deleted` };
    }
    await this.chatRepo.deleteSession(sessionId);
    return { message: `Session ${sessionId} deleted` };
  }
}
