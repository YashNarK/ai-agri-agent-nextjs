"use client";

// ============================================================
// components/theme-provider.tsx
//
// Wraps next-themes with the class strategy shadcn expects: the `dark`
// class on <html>, matching the `@custom-variant dark (&:is(.dark *))`
// declared in app/globals.css.
//
// The chart palette has a SELECTED dark set — the same eight hues
// re-stepped for the dark surface and validated against it, not an
// automatic inversion — so toggling here swaps a deliberate palette,
// not a filter.
// ============================================================

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
