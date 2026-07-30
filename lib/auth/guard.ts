// ============================================================
// lib/auth/guard.ts
//
// The Data Access Layer for authorisation — the checks that actually
// decide anything, kept close to the data rather than at the edge.
//
// proxy.ts also redirects unauthenticated visitors, but that is an
// optimistic check on a cookie's presence and is not a security
// boundary: it never runs for a Server Action, and a route handler
// called directly does not pass through it in any way that could be
// relied on. Everything that costs money calls one of these instead.
//
// The distinction that matters throughout: `authenticated` means we
// know who you are, `approved` means the admin has said you may spend.
// A pending user is fully signed in and still allowed nothing.
// ============================================================

import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { ApiError } from "@/lib/errors";
import type { UserRole, UserStatus } from "@/repositories/user.repository";

export interface Viewer {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: UserRole;
  status: UserStatus;
}

/**
 * The current viewer, or null when signed out.
 *
 * Wrapped in React's `cache` so several components on one page share a
 * single resolution per render pass instead of each re-running the jwt
 * callback (which may hit the database).
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    role: session.user.role,
    status: session.user.status,
  };
});

// ============================================================
// Page guards — redirect, because a browser deserves a destination
// ============================================================

/** Signed in and approved, or redirected somewhere that explains why not. */
export async function requireApproved(returnTo?: string): Promise<Viewer> {
  const viewer = await getViewer();

  if (!viewer) {
    const target = returnTo
      ? `/login?callbackUrl=${encodeURIComponent(returnTo)}`
      : "/login";
    redirect(target);
  }

  if (viewer.status !== "approved") {
    redirect("/pending-approval");
  }

  return viewer;
}

/** Approved AND an admin. Used by the approval queue itself. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireApproved("/dashboard/admin/users");
  if (viewer.role !== "admin") {
    // Not redirect('/dashboard'): a non-admin who guessed the URL should
    // be told no, not quietly bounced somewhere that looks like success.
    redirect("/dashboard?error=forbidden");
  }
  return viewer;
}

// ============================================================
// Route-handler guards — status codes, because a client needs to
// distinguish "log in" from "you are not allowed"
// ============================================================

/**
 * Throws ApiError(401) when signed out and ApiError(403) when signed in
 * but not approved, so `toErrorResponse` renders them in the same
 * `{"detail": "..."}` shape as every other error in this API.
 *
 * 401 vs 403 is load-bearing here: 401 tells a client to authenticate,
 * while a pending user authenticating again would change nothing.
 */
export async function requireApprovedApi(): Promise<Viewer> {
  const viewer = await getViewer();

  if (!viewer) {
    throw new ApiError(401, "Authentication required.");
  }

  if (viewer.status !== "approved") {
    throw new ApiError(
      403,
      viewer.status === "rejected"
        ? "Your access request was declined."
        : "Your account is awaiting administrator approval.",
    );
  }

  return viewer;
}
