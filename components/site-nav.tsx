"use client";

// ============================================================
// components/site-nav.tsx
// Top navigation. Client-side only for the active-route highlight.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "@/components/mode-toggle";
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

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Agricultural Intelligence
        </Link>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.map((link) => {
            // exact match for the index, prefix match for sections, so
            // /dashboard doesn't stay lit on every child route
            const active =
              link.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(link.href);
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

        {authMenu}
        <ModeToggle />
      </div>
    </header>
  );
}
