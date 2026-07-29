"use client";

// ============================================================
// app/dashboard/forecasts/forecast-row.tsx
//
// A selectable table row. Kept as the only Client Component on the
// page so the table itself stays server-rendered — this exists purely
// to push the selected id into the URL.
// ============================================================

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTransition } from "react";

import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function ForecastRow({
  id,
  selected,
  children,
}: {
  id: number;
  selected: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const select = () =>
    startTransition(() => router.push(`/dashboard/forecasts?id=${id}`));

  return (
    <TableRow
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={select}
      // keyboard parity: a row acting as a button must respond to
      // Enter and Space, not just a pointer
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
      className={cn(
        "cursor-pointer",
        selected && "bg-muted/60",
        isPending && "opacity-60",
      )}
    >
      {children}
    </TableRow>
  );
}
