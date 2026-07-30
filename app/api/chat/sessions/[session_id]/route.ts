// ============================================================
// app/api/chat/sessions/[session_id]/route.ts
//
// GET    — fetch a chat session by id (404 if unknown)
// DELETE — permanently delete a session and, via the FK cascade,
//          all of its messages. Idempotent: deleting a session that
//          is already gone returns 200 with a graceful message rather
//          than 404, so cleanup jobs and logout flows can call it
//          blindly.
//
// Port of routers/chat.py
// ============================================================

import { NextResponse } from "next/server";

import { requireApprovedApi } from "@/lib/auth/guard";
import { chatService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * 404s a session the viewer does not own.
 *
 * Same reasoning as the transcript route: "not yours" and "not there"
 * are deliberately indistinguishable, so probing ids reveals nothing.
 */
async function requireOwnedSession(sessionId: string, viewerId: string) {
  const session = await chatService.getSession(sessionId).catch(() => null);
  if (!session || session.user_id !== viewerId) {
    throw new ApiError(404, `Session ${sessionId} not found`);
  }
  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const viewer = await requireApprovedApi();
    const { session_id } = await params;
    return NextResponse.json(await requireOwnedSession(session_id, viewer.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const viewer = await requireApprovedApi();
    const { session_id } = await params;

    // Idempotent, as documented above — and a session owned by someone
    // else takes the same branch as one that never existed, so this
    // stays a no-op instead of becoming an ownership oracle.
    const session = await chatService.getSession(session_id).catch(() => null);
    if (!session || session.user_id !== viewer.id) {
      return NextResponse.json({
        message: `Session ${session_id} already deleted`,
      });
    }

    return NextResponse.json(await chatService.deleteSession(session_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
