// ============================================================
// components/charts/theme.ts
//
// The chart palette, as roles rather than raw hex.
//
// Every value resolves to a CSS custom property defined in
// app/globals.css, so light and dark swap in one place and d3 output
// stays consistent with the shadcn surface it sits on.
//
// The palette was validated against this app's actual card surfaces
// (#ffffff light, #171717 dark) — lightness band, chroma floor,
// adjacent-pair CVD separation, normal-vision floor and contrast.
// Two results from that run constrain how these are used:
//
//   1. On the LIGHT surface, aqua/yellow/magenta fall below 3:1. Any
//      chart using slots 3-5 must ship direct labels or a table view.
//   2. Charts whose marks are compared ALL-pairs rather than adjacently
//      (scatter, bubble, choropleth) are capped at SERIES_CAP_ALL_PAIRS
//      slots — past three, fold the rest into "Other" or facet.
//
// Slot order is the colorblind-safety mechanism, not decoration.
// Assign in fixed order, never cycle, and never reassign by rank —
// a filter that changes the series count must not repaint survivors.
// ============================================================

/** Categorical slots, in the fixed order they must be assigned. */
export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

/**
 * Maximum series for forms where every pair can be adjacent on screen
 * (scatter, bubble, choropleth). Adjacent-comparison forms — lines,
 * stacked bars — may use all eight.
 */
export const SERIES_CAP_ALL_PAIRS = 3;

/**
 * Colour for series `index`, by identity. Callers pass a stable index
 * derived from the entity (not its rank), so re-sorting or filtering
 * never changes an entity's colour.
 */
export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

/** Sequential ramp, light → dark. One hue, for continuous magnitude. */
export const SEQUENTIAL = [
  "var(--seq-100)",
  "var(--seq-250)",
  "var(--seq-400)",
  "var(--seq-550)",
  "var(--seq-700)",
] as const;

/** Diverging poles with a neutral midpoint, for signed magnitude. */
export const DIVERGING = {
  negative: "var(--div-neg)",
  mid: "var(--div-mid)",
  positive: "var(--div-pos)",
} as const;

/** Chrome. Recessive by design — never competes with the data. */
export const CHROME = {
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  muted: "var(--chart-muted)",
} as const;

/** Mark geometry, fixed so every chart in the app reads as one system. */
export const MARKS = {
  /** Line stroke width. Thin — the data, not the ink, carries weight. */
  lineWidth: 2,
  /** Rounded data-ends on bars. */
  barRadius: 4,
  /** Minimum scatter/dot radius; below this, marks stop being clickable. */
  dotRadius: 4,
  /** Surface gap between adjacent fills, so bars never visually merge. */
  gap: 2,
  /** Confidence/uncertainty bands sit behind their line at this opacity. */
  bandOpacity: 0.18,
} as const;
