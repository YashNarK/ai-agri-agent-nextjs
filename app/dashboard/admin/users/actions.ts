"use server";

// ============================================================
// app/dashboard/admin/users/actions.ts
//
// Approve and reject, as server actions.
//
// Each one re-checks admin rights rather than trusting that the page
// that rendered the button did. A server action is a public endpoint
// with a generated name — reachable by anyone who finds the id, not
// only by whoever the UI showed the form to.
// ============================================================

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/guard";
import { userRepo } from "@/lib/container";

const ADMIN_PATH = "/dashboard/admin/users";

async function setStatus(userId: string, status: "approved" | "rejected") {
  const admin = await requireAdmin();

  // Changing your own status would let an admin lock themselves out of
  // the only page that could undo it.
  if (userId === admin.id) {
    throw new Error("You cannot change your own access status.");
  }

  await userRepo.setStatus(userId, status, admin.id);
  revalidatePath(ADMIN_PATH);
}

export async function approveUser(formData: FormData) {
  await setStatus(String(formData.get("userId") ?? ""), "approved");
}

export async function rejectUser(formData: FormData) {
  await setStatus(String(formData.get("userId") ?? ""), "rejected");
}
