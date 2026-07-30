"use client";

// ============================================================
// components/ui/table-toolbar.tsx
//
// Search and paging controls for server-paginated tables.
//
// Both write to the URL rather than to component state. That is what
// makes a filtered page shareable, survivable across reload and
// back/forward, and — the reason it matters here — resolvable on the
// SERVER: the page reads searchParams and queries only the rows it
// needs. 750 forecasts never reach the browser.
//
// Search is debounced because every keystroke would otherwise be a
// database round trip and a full server render.
// ============================================================

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

function useUrlWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    // scroll:false — paging should not fling you back to the top of the
    // page; the table you are reading stays where it is.
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

export function TableSearch({
  placeholder = "Search…",
  paramName = "q",
  /** Cleared alongside the query, so a new search starts at page 1. */
  resetParams = ["page"],
}: {
  placeholder?: string;
  paramName?: string;
  resetParams?: string[];
}) {
  const searchParams = useSearchParams();
  const write = useUrlWriter();
  const [pending, startTransition] = useTransition();

  const urlValue = searchParams.get(paramName) ?? "";
  const [value, setValue] = useState(urlValue);
  const [seenUrlValue, setSeenUrlValue] = useState(urlValue);

  // Adopt the URL when it changes from OUTSIDE this input — a back
  // navigation, or a link that clears the filter.
  //
  // Adjusted during render rather than in an effect: setting state in an
  // effect renders once with the stale value and then again with the
  // new one, which is both a wasted pass and a visible flash. React
  // re-runs this component immediately instead, before committing
  // anything. Guarded by the previous URL value so it is not an infinite
  // loop.
  if (urlValue !== seenUrlValue) {
    setSeenUrlValue(urlValue);
    setValue(urlValue);
  }

  useEffect(() => {
    if (value === urlValue) return;
    const timer = setTimeout(() => {
      startTransition(() => {
        write({
          [paramName]: value || null,
          ...Object.fromEntries(resetParams.map((p) => [p, null])),
        });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `write` and `resetParams` are recreated each render; depending on
    // them would restart the timer on every keystroke's re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, urlValue, paramName]);

  return (
    <div className="relative w-full max-w-xs">
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <span
        aria-live="polite"
        className={cn(
          "absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground transition-opacity",
          pending ? "opacity-100" : "opacity-0",
        )}
      >
        …
      </span>
    </div>
  );
}

export function TablePagination({
  page,
  pageSize,
  total,
  paramName = "page",
}: {
  page: number;
  pageSize: number;
  total: number;
  paramName?: string;
}) {
  const write = useUrlWriter();
  const [pending, startTransition] = useTransition();

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const go = (next: number) =>
    startTransition(() => {
      // Page 1 drops the parameter entirely, so the canonical URL for a
      // table's first page has no query noise on it.
      write({ [paramName]: next <= 1 ? null : String(next) });
    });

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {total === 0
          ? "No matching forecasts"
          : `${first}–${last} of ${total}`}
      </p>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1 || pending}
          onClick={() => go(page - 1)}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {page} / {pageCount}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount || pending}
          onClick={() => go(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
