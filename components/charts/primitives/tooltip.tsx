"use client";

// ============================================================
// components/charts/primitives/tooltip.tsx
//
// The hover layer. An HTML/SVG chart is interactive by default, so this
// ships with every plotted form — only a bare stat tile skips it.
//
// Positioned in HTML above the SVG rather than inside it: SVG has no
// text wrapping, and an HTML tooltip inherits the app's type and
// surface tokens for free.
//
// Values wear ink tokens; a colour swatch beside them carries identity.
// ============================================================

import type { ReactNode } from "react";

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

interface ChartTooltipProps {
  /** Pixel position within the container; null hides the tooltip. */
  x: number | null;
  y: number | null;
  title: string;
  rows: TooltipRow[];
  containerWidth: number;
}

const WIDTH_ESTIMATE = 180;

export function ChartTooltip({
  x,
  y,
  title,
  rows,
  containerWidth,
}: ChartTooltipProps) {
  if (x === null || y === null) return null;

  // flip to the left of the cursor when the tooltip would overflow the
  // container, so it never gets clipped at the right edge
  const flip = x + WIDTH_ESTIMATE > containerWidth;

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-2 text-popover-foreground shadow-md"
      style={{
        left: flip ? undefined : x + 12,
        right: flip ? containerWidth - x + 12 : undefined,
        top: Math.max(0, y - 12),
        minWidth: 140,
      }}
    >
      <p className="mb-1 text-xs font-medium">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {row.color && (
                <span
                  aria-hidden="true"
                  className="inline-block size-2 shrink-0 rounded-[2px]"
                  style={{ background: row.color }}
                />
              )}
              {row.label}
            </span>
            <span className="font-medium tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical crosshair for line and area charts. */
export function Crosshair({
  x,
  innerHeight,
  children,
}: {
  x: number | null;
  innerHeight: number;
  children?: ReactNode;
}) {
  if (x === null) return null;
  return (
    <g aria-hidden="true">
      <line
        x1={x}
        x2={x}
        y1={0}
        y2={innerHeight}
        stroke="currentColor"
        strokeWidth={1}
        className="text-muted-foreground/40"
      />
      {children}
    </g>
  );
}
