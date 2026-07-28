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

import { chatService } from "@/lib/container";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const { session_id } = await params;
    return NextResponse.json(await chatService.getSession(session_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const { session_id } = await params;
    return NextResponse.json(await chatService.deleteSession(session_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
