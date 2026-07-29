"use client";

// ============================================================
// components/mode-toggle.tsx
//
// Light/dark switch.
//
// Both icons are always rendered and CSS picks which one shows, keyed
// off the same `dark` class next-themes puts on <html>. That avoids the
// usual mounted-flag dance: there is no setState in an effect, no
// hydration mismatch, and no first-paint flash — the server emits both
// icons and the stylesheet resolves it before React ever runs.
// ============================================================

import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light and dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <span aria-hidden="true" className="text-base leading-none dark:hidden">
        ☾
      </span>
      <span
        aria-hidden="true"
        className="hidden text-base leading-none dark:inline"
      >
        ☀
      </span>
    </Button>
  );
}
