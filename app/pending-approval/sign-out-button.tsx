// ============================================================
// app/pending-approval/sign-out-button.tsx
//
// Sign-out as a server action, so no client bundle is needed for the
// one interactive element on an otherwise static page.
// ============================================================

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <form action={doSignOut}>
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
