"use client";

// ============================================================
// components/charts/correlation-matrix.tsx
//
// Pearson correlation between a crop's price and each macro indicator
// the model consumes.
//
// DIVERGING encoding, because correlation has polarity: -1 and +1 are
// opposites, and 0 means "nothing". So it is two hues with a NEUTRAL
// GREY midpoint — never a rainbow, and never a hue at the middle, which
// would make "no relationship" look like a value in its own right.
//
// The coefficient is printed in every cell. Colour alone cannot convey
// a number, and at this size the text costs nothing.
//
// HONESTY NOTE: correlation over a monthly series is descriptive, not
// causal, and these series are non-stationary — so the label says
// "moves with", not "drives". The value is also stated as what it is: a
// coefficient over the overlapping months, nothing more.
// ============================================================

import { useMemo } from "react";

import { DIVERGING, MARKS } from "./theme";

export interface CorrelationRow {
  label: string;
  coefficient: number;
  /** Months where both series had a value. */
  overlap: number;
}

// pearson() deliberately lives in components/charts/stats.ts, which has
// no "use client": the coefficients are computed on the server, and a
// function exported from this file would be client-only and unusable
// from a Server Component.

/** Blends toward a pole by |r|, through the neutral midpoint. */
function cellColor(r: number): string {
  const magnitude = Math.min(1, Math.abs(r));
  const pole = r >= 0 ? DIVERGING.positive : DIVERGING.negative;
  // color-mix keeps the ramp in CSS, so both poles and the midpoint
  // stay theme-swappable rather than being computed to fixed hex here
  return `color-mix(in oklab, ${pole} ${Math.round(magnitude * 100)}%, ${DIVERGING.mid})`;
}

export function CorrelationMatrix({ rows }: { rows: CorrelationRow[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient)),
    [rows],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough overlapping months to compare against the macro indicators.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {sorted.map((row) => (
          <li key={row.label} className="flex items-center gap-3">
            <span className="w-48 shrink-0 text-xs text-muted-foreground">
              {row.label}
            </span>
            <span
              className="flex h-8 flex-1 items-center justify-center rounded-[4px] text-xs font-medium tabular-nums"
              style={{
                background: cellColor(row.coefficient),
                // ink stays a text token; the cell carries the encoding
                color: "var(--foreground)",
                marginInline: MARKS.gap,
              }}
            >
              {row.coefficient >= 0 ? "+" : ""}
              {row.coefficient.toFixed(2)}
            </span>
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {row.overlap} mo
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Moves opposite</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full">
          {[-1, -0.5, 0, 0.5, 1].map((stop) => (
            <span
              key={stop}
              className="flex-1"
              style={{ background: cellColor(stop) }}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Moves together</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Pearson correlation over the overlapping months. Descriptive only —
        this says the two series moved together, not that one caused the
        other.
      </p>
    </div>
  );
}
