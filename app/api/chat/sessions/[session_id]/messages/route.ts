// ============================================================
// app/api/chat/sessions/[session_id]/messages/route.ts
//
// GET — the persisted transcript for one session, oldest message
//       first. What the assistant page reads on mount to restore a
//       conversation after a reload.
//
// An unknown session is NOT a 404 here: the thread id lives in the URL,
// so the first visit to a freshly minted one is a legitimate read of a
// conversation that has not happened yet. It returns an empty list, and
// the client renders an empty chat either way.
// ============================================================

import { NextResponse } from "next/server";

import { requireApprovedApi } from "@/lib/auth/guard";
import { chatService } from "@/lib/container";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
// the transcript changes with every turn; a cached one would show the
// conversation as it was, which is precisely the bug this route fixes
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const viewer = await requireApprovedApi();
    const { session_id } = await params;
    return NextResponse.json(
      await chatService.getTranscript(session_id, viewer.id),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
