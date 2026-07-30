// ============================================================
// app/dashboard/admin/users/page.tsx
//
// The approval queue — the admin half of the two-gate design.
//
// Pending requests come first because they are the only rows that need
// a decision; everyone else is shown below for context and revocation.
// ============================================================

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/guard";
import { userRepo } from "@/lib/container";

import { approveUser, rejectUser } from "./actions";

export const metadata = { title: "Access requests" };
export const dynamic = "force-dynamic";

type UserRow = Awaited<ReturnType<typeof userRepo.listAll>>[number];

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "approved"
      ? "default"
      : status === "rejected"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function identify(user: UserRow): string {
  return (
    user.name ||
    user.email ||
    (user.github_login ? `@${user.github_login}` : user.id)
  );
}

function ActionButtons({
  user,
  isSelf,
}: {
  user: UserRow;
  isSelf: boolean;
}) {
  if (isSelf) {
    return <span className="text-xs text-muted-foreground">you</span>;
  }

  return (
    <div className="flex justify-end gap-2">
      {user.status !== "approved" && (
        <form action={approveUser}>
          <input type="hidden" name="userId" value={user.id} />
          <Button type="submit" size="sm">
            Approve
          </Button>
        </form>
      )}
      {user.status !== "rejected" && (
        <form action={rejectUser}>
          <input type="hidden" name="userId" value={user.id} />
          <Button type="submit" size="sm" variant="outline">
            {user.status === "approved" ? "Revoke" : "Decline"}
          </Button>
        </form>
      )}
    </div>
  );
}

function UserTable({
  users,
  adminId,
  empty,
}: {
  users: UserRow[];
  adminId: string;
  empty: string;
}) {
  if (users.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>GitHub</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Requested</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="font-medium">{identify(user)}</TableCell>
            <TableCell className="text-muted-foreground">
              {user.github_login ? `@${user.github_login}` : "—"}
            </TableCell>
            <TableCell>{user.role}</TableCell>
            <TableCell>
              <StatusBadge status={user.status} />
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {user.created_at.toISOString().slice(0, 10)}
            </TableCell>
            <TableCell className="text-right">
              <ActionButtons user={user} isSelf={user.id === adminId} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  const all = await userRepo.listAll();
  const pending = all.filter((user) => user.status === "pending");
  const decided = all.filter((user) => user.status !== "pending");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Access requests
        </h1>
        <p className="text-sm text-muted-foreground">
          Signing in creates an account; approving one is what lets it reach
          the assistant, knowledge search and forecasts.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pending{pending.length > 0 ? ` (${pending.length})` : ""}
          </CardTitle>
          <CardDescription>
            Waiting on a decision. Nothing here can spend anything yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserTable
            users={pending}
            adminId={admin.id}
            empty="No pending requests."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Everyone else</CardTitle>
          <CardDescription>
            Approved and declined accounts. Revoking takes effect within a
            minute, without waiting for the user to sign out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserTable
            users={decided}
            adminId={admin.id}
            empty="No decided accounts yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
