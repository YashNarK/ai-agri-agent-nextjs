"use client";

// ============================================================
// components/chat/copilot-provider.tsx
//
// The CopilotKit provider, mounted by the dashboard layout rather than
// by the assistant page.
//
// WHY IT LIVES IN THE LAYOUT: the provider owns the CopilotKit core, and
// the core owns the agent instances that hold the running transcript.
// Mounted on the page, it was torn down the moment you navigated away,
// taking the messages with it — so coming back rebuilt an empty agent
// even when the thread id was unchanged. A layout is not remounted while
// you navigate within it, so the agent now outlives leaving the page.
//
// Full reloads are a different matter — nothing client-side survives
// those, which is what the transcript rehydration in assistant-chat.tsx
// is for.
// ============================================================

import { CopilotKitProvider } from "@copilotkit/react-core/v2";

import { toolRenderers } from "@/components/chat/tool-renderers";

import "@copilotkit/react-core/v2/styles.css";

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" renderToolCalls={toolRenderers}>
      {children}
    </CopilotKitProvider>
  );
}
