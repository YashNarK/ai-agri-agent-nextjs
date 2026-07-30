// ============================================================
// app/dashboard/layout.tsx
//
// Wraps the dashboard in the CopilotKit provider — but only for a
// viewer who can actually use the assistant.
//
// The provider is at layout level rather than on the assistant page so
// that it is not remounted when you navigate between dashboard routes;
// see the comment in components/chat/copilot-provider.tsx for what that
// remounting used to cost.
//
// It is CONDITIONAL because most of this dashboard is public. The
// provider connects to /api/copilotkit/info as soon as it mounts, and
// that route is guarded — so mounting it for an anonymous visitor on a
// public page like /dashboard/regions produced a 401 and a console
// error on every page load, for a feature they cannot reach anyway.
// Approved viewers still get one provider spanning every route.
// ============================================================

import { CopilotProvider } from "@/components/chat/copilot-provider";
import { getViewer } from "@/lib/auth/guard";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await getViewer();

  if (viewer?.status !== "approved") return <>{children}</>;

  return <CopilotProvider>{children}</CopilotProvider>;
}
