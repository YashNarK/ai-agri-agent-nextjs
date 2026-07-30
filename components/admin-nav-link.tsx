// ============================================================
// components/admin-nav-link.tsx
//
// The admin's "Access requests" entry for the mobile menu sheet.
//
// A Server Component so the role check stays on the server, passed into
// SiteNav as a slot the way AuthMenu is. On md and up the same
// destination appears as a button in the top bar (see auth-menu.tsx);
// on a phone that bar has no room, so it lives here with the other
// navigation instead.
// ============================================================

import Link from "next/link";

import { getViewer } from "@/lib/auth/guard";

export async function AdminNavLink() {
  const viewer = await getViewer();
  if (viewer?.role !== "admin") return null;

  return (
    <Link
      href="/dashboard/admin/users"
      className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
    >
      Access requests
    </Link>
  );
}
