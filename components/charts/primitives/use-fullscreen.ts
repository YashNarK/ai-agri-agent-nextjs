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

import { cn } from "@/lib/utils";

/**
 * Classes for the expanded container.
 *
 * The two modes need different geometry, which is the bug this replaced:
 * the overlay path used to get `h-screen` and nothing else, so it grew
 * inside the normal document flow instead of covering it — the chart
 * simply became tall and clipped.
 *
 * Native fullscreen needs no positioning at all: the element IS the
 * viewport, so it only needs a background, since fullscreen paints the
 * element rather than the page behind it. The fallback needs to be a
 * real overlay.
 */
export function expandedClasses(
  isFullscreen: boolean,
  isOverlay: boolean,
): string {
  if (!isFullscreen) return "";
  return cn(
    "flex flex-col bg-background p-6",
    isOverlay ? "fixed inset-0 z-50 h-dvh w-screen" : "h-screen",
  );
}

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
