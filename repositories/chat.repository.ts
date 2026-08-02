// ============================================================
// repositories/chat.repository.ts
// Chat session + message persistence
// ============================================================

import type { RunTrace } from "@/agents/trace";
import type { Prisma } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { ToolCallRecord } from "@/lib/schemas";

export interface PersistTurnInput {
  sessionId: string;
  userMessage: string;
  aiMessage: string;
  toolCalls: ToolCallRecord[] | null;
  langgraphState?: Record<string, unknown> | null;
  /**
   * The run's step-by-step trace, written to the `tool_results` column.
   *
   * That column has existed since sql/06_chat.sql and was never
   * written — which is why a reloaded conversation could show the answer
   * but nothing about how it was reached.
   */
  trace?: RunTrace | null;
}

export class ChatRepository {
  async findSession(sessionId: string) {
    const prisma = await getPrisma();
    return prisma.chat_sessions.findUnique({ where: { id: sessionId } });
  }

  /**
   * Creates the session only if it does not already exist.
   * `upsert` with an empty update makes resuming a session a no-op
   * instead of a unique-violation race between concurrent turns.
   *
   * Ownership-blind by design — it is the low-level primitive. Anything
   * reachable by a signed-in user must go through `claimSession`.
   */
  async ensureSession(sessionId: string, userId?: string | null) {
    const prisma = await getPrisma();
    return prisma.chat_sessions.upsert({
      where: { id: sessionId },
      update: {},
      create: { id: sessionId, user_id: userId ?? null },
    });
  }

  /**
   * Claims a session for a user, reporting whether they may use it.
   *
   * The thread id travels in the URL, so a user can name any session
   * they like — including one belonging to someone else. Creating it
   * blindly (as ensureSession does) meant the agent then resumed the
   * OTHER user's LangGraph checkpoint, handing over their conversation
   * in full. This is the check that stops that.
   *
   *   "created" — did not exist; now theirs
   *   "owned"   — already theirs
   *   "foreign" — exists and belongs to somebody else
   *
   * A pre-auth session with a NULL user_id is adopted by its first
   * signed-in caller rather than orphaned, which keeps conversations
   * started before accounts existed reachable.
   */
  async claimSession(
    sessionId: string,
    userId: string,
  ): Promise<"created" | "owned" | "foreign"> {
    const prisma = await getPrisma();
    const existing = await prisma.chat_sessions.findUnique({
      where: { id: sessionId },
      select: { user_id: true },
    });

    if (!existing) {
      await prisma.chat_sessions.create({
        data: { id: sessionId, user_id: userId },
      });
      return "created";
    }

    if (existing.user_id === userId) return "owned";

    if (existing.user_id === null) {
      await prisma.chat_sessions.update({
        where: { id: sessionId },
        data: { user_id: userId, updated_at: new Date() },
      });
      return "owned";
    }

    return "foreign";
  }

  /**
   * A user's conversations, most recently active first.
   *
   * Sessions with no messages are excluded: visiting the assistant mints
   * a thread id before anything is said, so every abandoned visit would
   * otherwise leave an empty row in the switcher.
   */
  async listSessionsForUser(userId: string, limit = 50) {
    const prisma = await getPrisma();
    return prisma.chat_sessions.findMany({
      where: { user_id: userId, chat_messages: { some: {} } },
      orderBy: { updated_at: "desc" },
      take: limit,
      select: {
        id: true,
        session_name: true,
        created_at: true,
        updated_at: true,
        _count: { select: { chat_messages: true } },
      },
    });
  }

  /**
   * Names a session from its opening message, once.
   *
   * Guarded on session_name being NULL so a long conversation keeps the
   * title it earned from its first question rather than drifting with
   * each new turn.
   */
  async setSessionNameIfEmpty(sessionId: string, name: string) {
    const prisma = await getPrisma();
    return prisma.chat_sessions.updateMany({
      where: { id: sessionId, session_name: null },
      data: { session_name: name },
    });
  }

  /**
   * One session's messages, oldest first — the order a transcript is read
   * in, and the order the chat UI rehydrates them in.
   */
  async listMessages(sessionId: string, limit = 200) {
    const prisma = await getPrisma();
    return prisma.chat_messages.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: "asc" },
      take: limit,
    });
  }

  /** Writes the human + AI messages for one turn in a single round trip. */
  async persistTurn({
    sessionId,
    userMessage,
    aiMessage,
    toolCalls,
    langgraphState,
    trace,
  }: PersistTurnInput) {
    const prisma = await getPrisma();

    const written = await prisma.chat_messages.createMany({
      data: [
        { session_id: sessionId, role: "human", content: userMessage },
        {
          session_id: sessionId,
          role: "ai",
          content: aiMessage,
          tool_calls: (toolCalls ?? undefined) as Prisma.InputJsonValue | undefined,
          tool_results: (trace ?? undefined) as Prisma.InputJsonValue | undefined,
          langgraph_state: (langgraphState ??
            undefined) as Prisma.InputJsonValue | undefined,
        },
      ],
    });

    // Keeps `updated_at` meaning "last said something", which is the
    // order the conversation switcher lists in. Without this it would
    // only ever record when the session row was created, and the list
    // would freeze in creation order.
    await prisma.chat_sessions.update({
      where: { id: sessionId },
      data: { updated_at: new Date() },
    });

    return written;
  }

  /** Cascade delete removes the session's messages via the FK. */
  async deleteSession(sessionId: string) {
    const prisma = await getPrisma();
    return prisma.chat_sessions.delete({ where: { id: sessionId } });
  }
}
