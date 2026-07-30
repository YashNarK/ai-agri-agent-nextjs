"use server";

// ============================================================
// app/dashboard/assistant/actions.ts
//
// Conversation management from the switcher.
//
// A server action is a public endpoint with a generated name, so this
// re-derives the viewer and re-checks ownership rather than trusting
// the page that rendered the form.
// ============================================================

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireApproved } from "@/lib/auth/guard";
import { chatService } from "@/lib/container";

const ASSISTANT_PATH = "/dashboard/assistant";

export async function deleteConversation(formData: FormData) {
  const viewer = await requireApproved(ASSISTANT_PATH);
  const threadId = String(formData.get("threadId") ?? "");
  if (!threadId) return;

  // Ownership before deletion, and silence when it fails: a thread id
  // belonging to someone else is treated exactly like one that does not
  // exist, so this cannot be used to discover which ids are real.
  const session = await chatService.getSession(threadId).catch(() => null);
  if (!session || session.user_id !== viewer.id) {
    revalidatePath(ASSISTANT_PATH);
    return;
  }

  await chatService.deleteSession(threadId);

  // The messages are gone but the LangGraph checkpoint is not — see the
  // note in chat.service.deleteSession. It is unreachable either way,
  // because reaching a thread now requires owning a session row.
  revalidatePath(ASSISTANT_PATH);
  redirect(ASSISTANT_PATH);
}
