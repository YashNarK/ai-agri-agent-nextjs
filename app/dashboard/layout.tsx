// ============================================================
// app/dashboard/layout.tsx
//
// Wraps every dashboard route in the CopilotKit provider.
//
// The provider is here rather than on the assistant page so that it is
// not remounted when you navigate between dashboard routes — see the
// comment in components/chat/copilot-provider.tsx for what that
// remounting used to cost. It renders no markup of its own, so pages
// that never open the assistant are unaffected.
// ============================================================

import { CopilotProvider } from "@/components/chat/copilot-provider";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <CopilotProvider>{children}</CopilotProvider>;
}
