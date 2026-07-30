// ============================================================
// app/api/chat/route.ts
//
// POST /api/chat — send a message to the LangGraph-powered
// agricultural AI agent.
//
// The agent uses the ReAct pattern (Reasoning + Acting) to decide
// whether to answer directly or call tools to gather real data first,
// looping until it has enough information for a complete answer.
//
// Sessions
//   - session_id omitted  → a new session is created and returned
//   - session_id provided → the conversation resumes with full memory
//   - sessions and messages are persisted to PostgreSQL
//
// Tool calls
//   Every tool call across the ENTIRE reasoning loop is collected into
//   `tool_calls`, not just those on the final message.
//
// Port of routers/chat.py
// ============================================================

import { NextResponse } from "next/server";

import { requireApprovedApi } from "@/lib/auth/guard";
import { chatService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { chatRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const viewer = await requireApprovedApi();

    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { message, session_id } = parsed.data;

    return NextResponse.json(
      await chatService.chat({
        message,
        sessionId: session_id,
        // The signed-in user, NOT the request body's user_id. That field
        // predates authentication and is now ignored: honouring it would
        // let any caller file their conversation under someone else's id.
        userId: viewer.id,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
