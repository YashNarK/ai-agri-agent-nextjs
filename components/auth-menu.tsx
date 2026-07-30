// ============================================================
// components/auth-menu.tsx
//
// The identity corner of the nav: who you are, the approval queue when
// you are the admin, and a way out.
//
// A Server Component so it can read the session directly. It is rendered
// inside a <Suspense> boundary by the layout, because resolving the
// viewer may hit the database and the rest of the shell should not wait
// behind that.
// ============================================================

import Link from "next/link";

import { signOut } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";

export async function AuthMenu() {
  const viewer = await getViewer();

  if (!viewer) {
    // buttonVariants on the Link rather than <Button asChild>: this
    // project's Button wraps a base-ui primitive that has no asChild.
    return (
      <Link
        href="/login"
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        Sign in
      </Link>
    );
  }

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="flex items-center gap-2">
      {/* Admin-only, and md-and-up only. It is a navigation destination,
          so on a phone it belongs in the menu sheet with the other
          links rather than competing with the brand for the one row —
          it was what forced the app name down to "Agricult…". */}
      {viewer.role === "admin" && (
        <Link
          href="/dashboard/admin/users"
          className={cn(
            buttonVariants({ size: "sm", variant: "ghost" }),
            "hidden md:inline-flex",
          )}
        >
          Requests
        </Link>
      )}

      {viewer.status !== "approved" && (
        <Badge variant="secondary" className="whitespace-nowrap">
          {viewer.status === "rejected" ? "declined" : "pending"}
        </Badge>
      )}

      {/* Truncated: a long display name is the one item here that can
          grow without bound, and it was pushing the row into overflow. */}
      <span className="hidden max-w-[16ch] truncate text-sm text-muted-foreground lg:inline">
        {viewer.name || viewer.email}
      </span>

      <form action={doSignOut}>
        <Button type="submit" size="sm" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}
