"use client";

// ============================================================
// components/site-nav.tsx
// Top navigation. Client-side only for the active-route highlight.
//
// TWO LAYOUTS, one source of links:
//
//   >= md : the links sit inline, as a horizontal strip.
//   <  md : they move into a slide-over sheet behind a menu button.
//
// The inline strip cannot simply shrink on a phone. Seven links plus the
// brand, the identity menu and a theme toggle need roughly 900px; below
// that the strip was squeezed to nothing and every route became
// unreachable — the app had a navigation bar with no navigation in it.
// A sheet is the honest answer at that width, not a smaller font.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/prices", label: "Prices" },
  { href: "/dashboard/forecasts", label: "Forecasts" },
  { href: "/dashboard/crops", label: "Crops" },
  { href: "/dashboard/regions", label: "Regions" },
  { href: "/dashboard/knowledge", label: "Knowledge" },
  { href: "/dashboard/assistant", label: "Assistant" },
];

/** Exact match for the index, prefix match for sections, so /dashboard
 *  does not stay lit on every child route. */
function isActive(href: string, pathname: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * `authMenu` arrives as a prop rather than being imported here.
 *
 * This component is a Client Component (it needs usePathname for the
 * active-route highlight), and a Client Component cannot render a
 * Server Component it imports. Passing the already-rendered element
 * through from the server layout is the supported interleaving, and it
 * keeps the session off the client bundle entirely.
 */
export function SiteNav({ authMenu }: { authMenu?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [seenPath, setSeenPath] = useState(pathname);

  // Close the sheet once the route actually changes, or it sits over the
  // page it was just used to open.
  //
  // Adjusted during render rather than in an effect: an effect renders
  // once with the sheet still open and again with it closed, which is a
  // visible flash of the old panel over the new page. Guarded by the
  // previous path so it is not a loop.
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[88rem] items-center gap-3 px-4 sm:gap-4 sm:px-6">
        {/* Menu button: phones only. */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open navigation menu"
                className="md:hidden"
              />
            }
          >
            <MenuIcon />
          </SheetTrigger>

          <SheetContent side="left" className="w-72">
            <SheetHeader>
              <SheetTitle>Navigate</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-2 pb-4">
              {LINKS.map((link) => {
                const active = isActive(link.href, pathname);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>

        <Link
          href="/"
          className="min-w-0 shrink truncate text-sm font-semibold tracking-tight md:shrink-0"
        >
          Agricultural Intelligence
        </Link>

        {/* The inline strip, from md up. Hidden rather than squeezed on
            phones — see the note at the top of this file. */}
        <nav className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = isActive(link.href, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:ml-0">
          {authMenu}
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
