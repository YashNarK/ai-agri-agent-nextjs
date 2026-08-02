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
import { asRunTrace, type RunTrace } from "@/agents/trace";
import { ApiError, notFound } from "@/lib/errors";
import type {
  ConversationSummary,
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

/**
 * A conversation's title, taken from the message that opened it.
 *
 * Not an LLM-generated summary: titling a conversation should not cost
 * a model call, and the opening question is what a user actually
 * remembers a thread by. Newlines collapse so a pasted block does not
 * turn into a multi-line entry in the switcher.
 */
export function titleFrom(firstMessage: string): string {
  const flat = firstMessage.replace(/\s+/g, " ").trim();
  if (flat === "") return "Untitled conversation";
  // 80 fits the sidebar at its widest without truncating mid-word for
  // most questions; longer ones get an ellipsis rather than a hard cut.
  if (flat.length <= 80) return flat;
  const cut = flat.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}

/** "3m", "2h", "5d" — enough to order by, short enough for a sidebar. */
export function relativeAge(at: Date, now: number): string {
  const minutes = Math.max(0, Math.round((now - at.getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
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

    // With a known user, go through the ownership check rather than the
    // blind upsert — see ensureOwnedSession.
    if (userId) return this.ensureOwnedSession(id, userId);

    await this.chatRepo.ensureSession(id, userId);
    return id;
  }

  /**
   * Resolves a session id for a known user, refusing one that belongs to
   * somebody else.
   *
   * The thread id is chosen by the client (it lives in the URL), so this
   * is the only thing standing between a user and another user's
   * conversation: the LangGraph checkpointer is keyed by thread id alone
   * and will happily resume any thread it is handed.
   */
  async ensureOwnedSession(sessionId: string, userId: string): Promise<string> {
    const outcome = await this.chatRepo.claimSession(sessionId, userId);
    if (outcome === "foreign") {
      throw new ApiError(403, "That conversation belongs to another account.");
    }
    return sessionId;
  }

  /**
   * Whether a thread id is usable by this viewer — theirs, or not yet
   * anybody's.
   *
   * Read-only, unlike ensureOwnedSession: the assistant page calls this
   * on every render to decide whether to show the thread at all, and
   * merely looking at a conversation should not create a row for it.
   * Brand-new ids are fine, since visiting the page mints one before a
   * word has been said.
   */
  async canUseThread(sessionId: string, viewerId: string): Promise<boolean> {
    const session = await this.chatRepo.findSession(sessionId);
    if (!session) return true;
    return session.user_id === null || session.user_id === viewerId;
  }

  /**
   * The signed-in user's conversations, for the switcher.
   *
   * Falls back to the session id when a conversation has no title —
   * which only happens for turns persisted before auto-titling, since
   * every new conversation is named from its opening message.
   */
  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.chatRepo.listSessionsForUser(userId);
    const now = Date.now();

    return rows.map((row) => ({
      id: row.id,
      title: row.session_name ?? "Untitled conversation",
      message_count: row._count.chat_messages,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      relative_age: relativeAge(row.updated_at, now),
    }));
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
    await this.chatRepo.setSessionNameIfEmpty(id, titleFrom(message));

    return { session_id: id, message: responseText, tool_calls: toolCalls };
  }

  /**
   * Persists one streamed turn once the SSE generator has finished.
   *
   * `trace` carries the run's steps with their arguments and results.
   * Before it existed this wrote `[{name}]` and nothing else, so a
   * reloaded conversation showed the answer with no record of how it was
   * reached — the tool cards rendered during the live run were the only
   * evidence, and they died with the connection. Tool names are still
   * written to `tool_calls` for the non-streaming route's benefit; the
   * arguments now ride along with them.
   */
  async persistStreamedTurn(
    sessionId: string,
    userMessage: string,
    finalText: string,
    toolNames: string[],
    trace?: RunTrace | null,
  ): Promise<void> {
    // prefer the trace's steps, which carry the args the model chose
    const fromTrace = trace?.steps
      .filter((step) => step.kind === "tool")
      .map((step) => ({ name: step.name, args: step.args }));

    const toolCalls =
      fromTrace && fromTrace.length > 0
        ? fromTrace
        : toolNames.length > 0
          ? toolNames.map((name) => ({ name }))
          : null;

    await this.chatRepo.persistTurn({
      sessionId,
      userMessage,
      aiMessage: finalText,
      toolCalls,
      trace: trace ?? null,
    });
    await this.chatRepo.setSessionNameIfEmpty(sessionId, titleFrom(userMessage));
  }

  /**
   * The persisted transcript for a session, for rehydrating the chat UI
   * after a reload.
   *
   * Deliberately tolerant of an unknown session: a thread id in the URL
   * that has never been used is the normal first-visit case, not an error,
   * and returning an empty transcript lets the client treat both the same.
   *
   * Only human and AI turns are replayed as MESSAGES. Each AI turn also
   * carries its run trace, which the accordion renders above it — that
   * is the record of how the answer was reached, and it is exactly what
   * a reloaded conversation used to lose.
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
      .map((row) => {
        const trace = asRunTrace(row.tool_results);
        return {
          id: String(row.id),
          role: row.role === "human" ? ("user" as const) : ("assistant" as const),
          content: row.content,
          // omitted rather than null so turns written before traces
          // existed serialise identically to how they always did
          ...(trace ? { trace } : {}),
        };
      });

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
   *
   * The FK cascade removes the messages. It does NOT remove the
   * LangGraph checkpoint for the same thread id, which lives in the
   * checkpointer's own tables and has no foreign key to here. Those rows
   * are unreachable afterwards — resuming a thread requires owning a
   * chat_sessions row, and this just deleted it — but they are not
   * reclaimed, so a periodic sweep is worth adding if churn grows.
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
