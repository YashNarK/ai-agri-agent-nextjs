"use client";

// ============================================================
// components/chat/run-navigation-guard.tsx
//
// Keeps the user on the page while an answer is streaming.
//
// WHY THIS EXISTS — AND WHY IT IS A STOPGAP
//
// The run is driven by the browser's connection, not by the server. When
// the chat component unmounts, AbstractAgent's observable is unsubscribed,
// which fires the teardown in AgriculturalAgent.run() and aborts the graph
// mid-flight (agents/agui-agent.ts). Two things are then lost:
//
//   1. The turn is never persisted — persistStreamedTurn() is skipped on
//      an aborted run, so nothing reaches chat_messages.
//   2. The partial answer was never state. LangGraph checkpoints at
//      SUPERSTEP boundaries (after `llm`, after `tools`), and streaming
//      tokens are a side-channel view of a node that has not returned yet.
//      Leave before the node commits and there is no checkpoint either.
//
// So leaving mid-answer does not "background" the run the way Claude or
// ChatGPT do — it destroys it. The real fix is to stop letting the HTTP
// connection own the run: write deltas to a durable buffer and hand the
// browser a resumable stream it can re-attach to by run id. Until that
// lands, the honest thing is to tell the user rather than silently eat
// their question.
//
// WHAT IT GUARDS
//
//   tab close / reload      → native beforeunload dialog (the only thing
//                             the browser lets us do here; the wording is
//                             the browser's, not ours)
//   in-app or outbound link → intercepted in the capture phase, replaced
//                             with a toast offering "Leave anyway"
//   back button / swipe     → a sentinel history entry, re-pushed on
//                             popstate, popped again when the run ends
//
// The back-button guard matters most on phones, where the swipe gesture
// is the primary way out of a page and there is no address bar to warn
// against.
// ============================================================

import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const TOAST_ID = "chat-run-navigation-guard";

/**
 * Anchors we deliberately let through.
 *
 * A new tab, a download and an in-page hash all leave this document —
 * and therefore the run — intact, so blocking them would be noise. A
 * modified click (ctrl/cmd/shift/middle) is the user asking for a new
 * tab too, even on an anchor without target="_blank".
 */
function isHarmlessClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.button !== 0) return true;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
  if (anchor.target && anchor.target !== "_self") return true;
  if (anchor.hasAttribute("download")) return true;

  const href = anchor.getAttribute("href");
  if (!href) return true;
  if (href.startsWith("#")) return true;
  // mailto:, tel:, and friends hand off to another app
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return true;

  return false;
}

/**
 * Blocks the ways out of the page while `agent.isRunning`.
 *
 * Renders nothing — it is all listeners. Mounted by AssistantChat so the
 * guard's lifetime matches the chat surface's.
 */
export function RunNavigationGuard() {
  const { agent } = useAgent({
    agentId: "agricultural",
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const running = agent.isRunning;

  // Set just before we deliberately perform the navigation the user
  // confirmed via "Leave anyway", so our own click handler does not
  // intercept the click it is about to synthesise.
  const bypass = useRef(false);

  useEffect(() => {
    if (!running) return;

    const warn = (onConfirm: () => void) => {
      toast.warning("The assistant is still answering", {
        id: TOAST_ID,
        // Sonner goes full-width below 600px, and its default bottom
        // placement would then sit directly on top of the composer — and
        // under the on-screen keyboard if one is open, where the "Leave
        // anyway" action is unreachable. Move it above the conversation on
        // phones instead. Read at toast time rather than from a resize
        // listener: the guard is only mounted for the length of a run.
        position: window.matchMedia("(max-width: 600px)").matches
          ? "top-center"
          : undefined,
        // Long enough to read on a phone, short enough not to linger over
        // the conversation. Dismissible, so it never traps the send button.
        duration: 8000,
        description:
          "Leaving now cancels this answer — it is not saved until the run " +
          "finishes. Give it a moment.",
        action: {
          label: "Leave anyway",
          onClick: () => {
            bypass.current = true;
            onConfirm();
          },
        },
      });
    };

    // ---- tab close / reload -------------------------------------------
    // Chrome and Safari ignore any custom string here and show their own
    // wording; preventDefault() is the whole API that still works.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Firefox and older engines still key off a non-empty returnValue
      event.returnValue = "";
    };

    // ---- links ---------------------------------------------------------
    // Capture phase, so this runs before Next's <Link> handler and before
    // any component-level onClick — by the bubble phase the router has
    // already started navigating.
    const onClick = (event: MouseEvent) => {
      if (bypass.current) return;

      const anchor = (event.target as Element | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!anchor || isHarmlessClick(event, anchor)) return;

      event.preventDefault();
      event.stopPropagation();
      warn(() => anchor.click());
    };

    // ---- back button / swipe-back --------------------------------------
    // popstate cannot be cancelled, so the only way to hold the page is to
    // keep a spare entry on the stack and push a replacement each time one
    // is consumed. The entry points at the current URL, so the address bar
    // never changes and the "forward" arrow stays meaningless.
    const sentinel = () =>
      window.history.pushState(null, "", window.location.href);
    sentinel();

    const onPopState = () => {
      if (bypass.current) return;
      sentinel();
      warn(() => {
        // two: the one we just re-pushed, plus the one the user meant
        window.history.go(-2);
      });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      toast.dismiss(TOAST_ID);

      // Reclaim the sentinel, or the first back-press after a run would be
      // swallowed by an entry the user never navigated to. The listeners
      // are already detached, so this pop is silent. Skipped when the user
      // chose to leave — the navigation is mid-flight and stepping on the
      // history stack now would fight it.
      if (!bypass.current) {
        window.history.back();
      }
      bypass.current = false;
    };
  }, [running]);

  return null;
}
