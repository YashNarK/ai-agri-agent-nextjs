"use client";

// ============================================================
// components/charts/similarity-bar.tsx
//
// Cosine similarity for one search result.
//
// A meter, not a chart. One value with a known 0–1 range has no shape
// to plot; a bar against a full-width track communicates "how close"
// instantly, and the number beside it gives the precision the bar
// cannot.
//
// The value is ALWAYS shown as text, so the reader never has to
// estimate a length — which is also the relief the palette validation
// requires wherever a fill sits below 3:1 on the light surface.
// ============================================================

import { seriesColor } from "./theme";

export function SimilarityBar({ value }: { value: number }) {
  // cosine similarity can go slightly negative for opposed vectors;
  // clamp so the bar never renders inverted
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Similarity</span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={Number(clamped.toFixed(2))}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-label="Cosine similarity to the query"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${clamped * 100}%`,
            background: seriesColor(0),
          }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium tabular-nums">
        {clamped.toFixed(2)}
      </span>
    </div>
  );
}
