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

/** Plain reads of our own database. No model, no external call. */
const DATA_LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/prices", label: "Prices" },
  { href: "/dashboard/crops", label: "Crops" },
  { href: "/dashboard/regions", label: "Regions" },
];

/**
 * The three surfaces backed by a model — Azure ML for forecasts, Azure
 * OpenAI embeddings for knowledge search, the LangGraph agent for chat.
 *
 * Grouped and marked deliberately: these are exactly the routes that
 * cost money per request and sit behind the approval gate, so the set a
 * user sees highlighted is the same set the guards protect. The visual
 * grouping is not decoration — it tells you which parts of the app are
 * doing inference.
 */
const AI_LINKS = [
  { href: "/dashboard/forecasts", label: "Forecasts" },
  { href: "/dashboard/knowledge", label: "Knowledge" },
  { href: "/dashboard/assistant", label: "Assistant" },
];

/** Neon edge shared by both layouts, so the two cannot drift apart. */
const AI_GROUP_FRAME =
  "rounded-xl border border-emerald-400/45 bg-emerald-400/[0.06] shadow-[0_0_12px_-3px_rgb(52_211_153/0.55)]";

/** Exact match for the index, prefix match for sections, so /dashboard
 *  does not stay lit on every child route. */
function isActive(href: string, pathname: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

/** Four-point sparkle — the conventional "this is model-backed" mark. */
function AiSparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"
        fill="currentColor"
      />
      <path
        d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}

/**
 * Closed padlock — these routes are behind the approval gate.
 *
 * Paired with the sparkle rather than replacing it because the two say
 * different things: the sparkle is "a model runs here", the lock is
 * "and you need to be approved to run it". They happen to cover the
 * same three routes, and that is not a coincidence — the gate exists
 * because inference costs money.
 */
function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect
        x="5" y="10.5" width="14" height="10" rx="2.5"
        fill="currentColor"
      />
      <path
        d="M8.5 10.5V7.75a3.5 3.5 0 1 1 7 0v2.75"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
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
export function SiteNav({
  authMenu,
  menuExtra,
}: {
  authMenu?: React.ReactNode;
  /** Rendered at the end of the mobile menu — admin-only destinations
   *  that have no room in the top bar at phone width. */
  menuExtra?: React.ReactNode;
}) {
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

  /**
   * Close on tap, not on arrival.
   *
   * The pathname check above is a safety net for back/forward; it is
   * the WRONG thing to close the menu on when the user taps a link. A
   * guarded route has to reach the server, resolve the session and
   * render — or redirect to /login — before `pathname` changes, so the
   * sheet sat open and unhighlighted for the whole round trip and the
   * tap felt ignored. Closing in the click handler makes the response
   * immediate and independent of how slow the destination is.
   */
  const close = () => setOpen(false);

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
              {DATA_LINKS.map((link) => {
                const active = isActive(link.href, pathname);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm transition-colors active:bg-secondary",
                      active
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <div onClick={close}>{menuExtra}</div>

              {/* The model-backed group, at the end on a phone. */}
              <div
                className={cn("mt-3 flex flex-col gap-1 p-2", AI_GROUP_FRAME)}
                aria-labelledby="ai-group-heading-mobile"
              >
                <p
                  id="ai-group-heading-mobile"
                  className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium tracking-[0.08em] text-emerald-500 uppercase dark:text-emerald-400"
                >
                  <AiSparkIcon className="size-3.5" />
                  AI features
                  <LockIcon className="size-3" />
                  <span className="sr-only">— sign-in and approval required</span>
                </p>
                {AI_LINKS.map((link) => {
                  const active = isActive(link.href, pathname);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-md px-3 py-2 text-sm transition-colors active:bg-emerald-400/25",
                        active
                          ? "bg-emerald-400/15 text-foreground"
                          : "text-muted-foreground hover:bg-emerald-400/10 hover:text-foreground",
                      )}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
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
          {DATA_LINKS.map((link) => {
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

          {/* ml-auto pushes the model-backed group to the right end of
              the strip, so it reads as its own region rather than the
              tail of the same list. */}
          <div
            className={cn("ml-auto flex items-center gap-0.5 py-0.5 pr-1 pl-2", AI_GROUP_FRAME)}
          >
            <span
              className="flex shrink-0 items-center gap-0.5 pr-0.5 text-emerald-500 dark:text-emerald-400"
              title="Model-backed · sign-in and approval required"
            >
              <AiSparkIcon className="size-3.5" />
              <LockIcon className="size-3" />
            </span>
            <span className="sr-only">
              AI features, sign-in and approval required:
            </span>
            {AI_LINKS.map((link) => {
              const active = isActive(link.href, pathname);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "bg-emerald-400/15 text-foreground"
                      : "text-muted-foreground hover:bg-emerald-400/10 hover:text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:ml-0">
          {authMenu}
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
