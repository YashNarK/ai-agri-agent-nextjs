// ============================================================
// repositories/chat.repository.ts
// Chat session + message persistence
// ============================================================

import type { Prisma } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { ToolCallRecord } from "@/lib/schemas";

export interface PersistTurnInput {
  sessionId: string;
  userMessage: string;
  aiMessage: string;
  toolCalls: ToolCallRecord[] | null;
  langgraphState?: Record<string, unknown> | null;
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
   */
  async ensureSession(sessionId: string, userId?: string | null) {
    const prisma = await getPrisma();
    return prisma.chat_sessions.upsert({
      where: { id: sessionId },
      update: {},
      create: { id: sessionId, user_id: userId ?? null },
    });
  }

  /** Writes the human + AI messages for one turn in a single round trip. */
  async persistTurn({
    sessionId,
    userMessage,
    aiMessage,
    toolCalls,
    langgraphState,
  }: PersistTurnInput) {
    const prisma = await getPrisma();
    return prisma.chat_messages.createMany({
      data: [
        { session_id: sessionId, role: "human", content: userMessage },
        {
          session_id: sessionId,
          role: "ai",
          content: aiMessage,
          tool_calls: (toolCalls ?? undefined) as Prisma.InputJsonValue | undefined,
          langgraph_state: (langgraphState ??
            undefined) as Prisma.InputJsonValue | undefined,
        },
      ],
    });
  }

  /** Cascade delete removes the session's messages via the FK. */
  async deleteSession(sessionId: string) {
    const prisma = await getPrisma();
    return prisma.chat_sessions.delete({ where: { id: sessionId } });
  }
}
