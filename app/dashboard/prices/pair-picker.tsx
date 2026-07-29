"use client";

// ============================================================
// app/dashboard/prices/pair-picker.tsx
//
// Crop and region selectors, driven by the pairs that actually have
// price history.
//
// Choosing a crop narrows the region list to regions with data for it,
// so an empty chart is unreachable by construction rather than handled
// after the fact. This is the UI-side use of the same
// findAvailablePairs() the agent relies on to avoid inventing codes.
// ============================================================

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AvailablePair } from "@/lib/schemas";

interface PairPickerProps {
  pairs: AvailablePair[];
  cropNames: Record<string, string>;
  regionNames: Record<string, string>;
  cropCode: string;
  regionCode: string;
}

export function PairPicker({
  pairs,
  cropNames,
  regionNames,
  cropCode,
  regionCode,
}: PairPickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const cropCodes = useMemo(
    () => [...new Set(pairs.map((p) => p.crop_code))].sort(),
    [pairs],
  );

  const regionCodes = useMemo(
    () =>
      [
        ...new Set(
          pairs.filter((p) => p.crop_code === cropCode).map((p) => p.region_code),
        ),
      ].sort(),
    [pairs, cropCode],
  );

  const navigate = (next: { crop?: string; region?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.crop) {
      params.set("crop", next.crop);
      // the current region may not exist for the new crop — fall back to
      // that crop's first available region rather than rendering empty
      const valid = pairs
        .filter((p) => p.crop_code === next.crop)
        .map((p) => p.region_code);
      if (!valid.includes(regionCode)) {
        params.set("region", valid[0] ?? "");
      }
    }
    if (next.region) params.set("region", next.region);

    startTransition(() => router.push(`/dashboard/prices?${params.toString()}`));
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-pending={isPending ? "" : undefined}
    >
      {/* onValueChange yields string | null; a null clear is a no-op
          here because the picker always has a valid selection */}
      <Select value={cropCode} onValueChange={(v) => v && navigate({ crop: v })}>
        <SelectTrigger className="w-[220px]" aria-label="Crop">
          <SelectValue placeholder="Select a crop" />
        </SelectTrigger>
        <SelectContent>
          {cropCodes.map((code) => (
            <SelectItem key={code} value={code}>
              {cropNames[code] ?? code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={regionCode}
        onValueChange={(v) => v && navigate({ region: v })}
      >
        <SelectTrigger className="w-[220px]" aria-label="Region">
          <SelectValue placeholder="Select a region" />
        </SelectTrigger>
        <SelectContent>
          {regionCodes.map((code) => (
            <SelectItem key={code} value={code}>
              {regionNames[code] ?? code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isPending && (
        <span className="text-xs text-muted-foreground">Loading…</span>
      )}
    </div>
  );
}
