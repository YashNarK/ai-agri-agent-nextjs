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
];

export function SiteNav() {
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

        <ModeToggle />
      </div>
    </header>
  );
}
