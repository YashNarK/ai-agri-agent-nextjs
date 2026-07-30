"use client";

// ============================================================
// components/charts/primitives/use-fullscreen.ts
//
// Puts one element into real fullscreen.
//
// The native Fullscreen API rather than a fixed-position overlay: it
// escapes the page's own layout entirely, so a chart is not still
// competing with a max-width container, a sticky header or a parent
// with overflow hidden. It also gives Escape-to-exit and the browser's
// own affordances for free.
//
// The API rejects for reasons that are not errors in any useful sense —
// permissions policy in an iframe, a request not tied to a user
// gesture — so failures fall back to a page-level overlay instead of
// leaving the user with a button that does nothing.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

export interface FullscreenState<T extends HTMLElement> {
  ref: React.RefObject<T | null>;
  isFullscreen: boolean;
  /** True when the browser refused fullscreen and we are faking it. */
  isOverlay: boolean;
  toggle: () => void;
}

export function useFullscreen<
  T extends HTMLElement = HTMLDivElement,
>(): FullscreenState<T> {
  const ref = useRef<T>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOverlay, setIsOverlay] = useState(false);

  // Track the browser's own state, so exiting with Escape or the
  // browser chrome keeps our state in step rather than leaving the
  // component convinced it is still expanded.
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === ref.current;
      setIsFullscreen((current) => (isOverlayActive() ? current : active));
    };
    const isOverlayActive = () => !document.fullscreenEnabled;

    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Escape only closes the overlay fallback; native fullscreen already
  // handles it, and listening in both modes would double-fire.
  useEffect(() => {
    if (!isOverlay || !isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
        setIsOverlay(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOverlay, isFullscreen]);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    if (isFullscreen) {
      if (isOverlay) {
        setIsFullscreen(false);
        setIsOverlay(false);
      } else if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {
          // already gone; the change handler will settle the state
        });
      } else {
        setIsFullscreen(false);
      }
      return;
    }

    if (!document.fullscreenEnabled) {
      setIsOverlay(true);
      setIsFullscreen(true);
      return;
    }

    void element
      .requestFullscreen()
      .then(() => {
        setIsOverlay(false);
        setIsFullscreen(true);
      })
      .catch(() => {
        setIsOverlay(true);
        setIsFullscreen(true);
      });
  }, [isFullscreen, isOverlay]);

  return { ref, isFullscreen, isOverlay, toggle };
}
