// ============================================================
// app/login/page.tsx
//
// Sign-in. Two doors, deliberately unequal:
//
//   GitHub    — how everyone gets in, including the admin
//   Password  — the admin's only, and rejected for anyone else by
//               auth.ts before a hash is even compared
//
// The password form is shown rather than hidden behind a flag. Hiding
// it would be security theatre — the endpoint exists either way — and a
// visible form that refuses non-admins is honest about the shape of the
// system.
// ============================================================

import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getViewer } from "@/lib/auth/guard";
import { redirect } from "next/navigation";

import { AdminPasswordForm, GithubSignInButton } from "./sign-in-forms";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  // Already signed in: skip the form. Approval status is not checked
  // here — an unapproved user still needs somewhere to land, and the
  // guard on the destination sends them to /pending-approval.
  const viewer = await getViewer();
  if (viewer) {
    redirect(callbackUrl || "/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Access to the assistant, knowledge search and forecasts is granted
            by the administrator after you sign in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error === "CredentialsSignin"
                ? "That email and password combination was not accepted."
                : "Sign-in failed. Please try again."}
            </p>
          )}

          <Suspense fallback={null}>
            <GithubSignInButton callbackUrl={callbackUrl} />
          </Suspense>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">
              administrator only
            </span>
            <Separator className="flex-1" />
          </div>

          <AdminPasswordForm callbackUrl={callbackUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
