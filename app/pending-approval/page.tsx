// ============================================================
// app/pending-approval/page.tsx
//
// Where a signed-in but unapproved user lands.
//
// This page is the reason auth.ts lets unapproved accounts sign in at
// all. Refusing them at the door would show a generic login error,
// which reads as "your account is broken" — the one thing it is not.
// Here the state is named, and so is the way out of it.
// ============================================================

import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getViewer } from "@/lib/auth/guard";

import { SignOutButton } from "./sign-out-button";

export const metadata = { title: "Awaiting approval" };
export const dynamic = "force-dynamic";

export default async function PendingApprovalPage() {
  const viewer = await getViewer();

  if (!viewer) redirect("/login");
  // Approved users have no business here; send them where they were going.
  if (viewer.status === "approved") redirect("/dashboard");

  const rejected = viewer.status === "rejected";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>
            {rejected ? "Access declined" : "Awaiting approval"}
          </CardTitle>
          <CardDescription>
            {rejected
              ? "The administrator declined this access request."
              : "Your account was created. An administrator needs to approve it before you can use the assistant, knowledge search or forecasts."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Signed in as</dt>
              <dd className="font-medium">
                {viewer.name || viewer.email || viewer.id}
              </dd>
            </div>
            {viewer.email && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium">{viewer.email}</dd>
              </div>
            )}
          </dl>

          <p className="text-sm text-muted-foreground">
            {rejected
              ? "If you believe this is a mistake, contact the administrator."
              : "Approval is manual. Once granted, reload this page — no need to sign in again."}
          </p>

          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
