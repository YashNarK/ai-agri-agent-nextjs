"use client";

// ============================================================
// components/charts/primitives/chart-frame.tsx
//
// The shell every chart sits in: a measured, responsive SVG plus the
// legend and tooltip layers.
//
// Accessibility contract enforced here rather than per chart:
//   - >= 2 series always get a legend, so identity is never carried by
//     colour alone
//   - the SVG carries a role and label for screen readers
//   - a swatch sits beside label TEXT, which wears ink tokens; text
//     never wears the series colour
// ============================================================

import type { ReactNode } from "react";

import type { ChartDimensions } from "./use-chart-dimensions";

export interface LegendItem {
  label: string;
  color: string;
}

interface ChartFrameProps {
  dimensions: ChartDimensions;
  containerRef: React.Ref<HTMLDivElement>;
  /** Describes the chart for assistive tech. */
  title: string;
  legend?: LegendItem[];
  children: ReactNode;
  /** Rendered above the SVG, e.g. a crosshair tooltip. */
  overlay?: ReactNode;
}

export function ChartFrame({
  dimensions,
  containerRef,
  title,
  legend,
  children,
  overlay,
}: ChartFrameProps) {
  const { width, height, margin } = dimensions;

  return (
    <div className="w-full">
      {legend && legend.length >= 2 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-[2px]"
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div ref={containerRef} className="relative w-full">
        {/* width is 0 until the ResizeObserver reports; skip the paint
            rather than emit a degenerate SVG */}
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={title}
            className="overflow-visible"
          >
            <g transform={`translate(${margin.left}, ${margin.top})`}>
              {children}
            </g>
          </svg>
        )}
        {overlay}
      </div>
    </div>
  );
}
