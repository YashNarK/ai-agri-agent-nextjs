"use client";

// ============================================================
// components/charts/primitives/chart-frame.tsx
//
// The shell every chart sits in: a measured, responsive SVG plus the
// legend, tooltip and expand layers.
//
// Accessibility contract enforced here rather than per chart:
//   - >= 2 series always get a legend, so identity is never carried by
//     colour alone
//   - the SVG carries a role and label for screen readers
//   - a swatch sits beside label TEXT, which wears ink tokens; text
//     never wears the series colour
//
// EXPAND lives here too, for the same reason: putting it in the shared
// frame means every chart drawn through it can go fullscreen, rather
// than each one reimplementing the affordance and drifting. Charts need
// no code of their own — useChartDimensions measures this container in
// both axes, so growing the box is all it takes for the scales to
// follow.
// ============================================================

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { ChartDimensions } from "./use-chart-dimensions";
import { useFullscreen } from "./use-fullscreen";

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
  /**
   * Resting height. The chart is measured, so this is what the box is
   * before expanding, not a ceiling.
   */
  height?: number;
  /** Opt out for inline sparkline-scale marks, where expanding is noise. */
  expandable?: boolean;
}

/**
 * The expand affordance, exported so the charts that draw their own SVG
 * (the globe, the heatmap, the weather panel) get the same control in
 * the same place rather than three near-misses.
 */
export function ExpandButton({
  isFullscreen,
  onToggle,
  title,
  className,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={
        isFullscreen ? `Exit fullscreen: ${title}` : `Expand ${title} to fullscreen`
      }
      aria-pressed={isFullscreen}
      className={cn(
        "shrink-0 rounded-md p-1.5 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100",
        // Revealed on hover so it does not compete with the data, but
        // always present for keyboard and touch.
        isFullscreen
          ? "opacity-100"
          : "opacity-0 group-hover/chart:opacity-70 focus-visible:opacity-100",
        className,
      )}
    >
      <ExpandIcon expanded={isFullscreen} />
    </button>
  );
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
      <path
        d={
          expanded
            ? "M9 9H4m5 0V4m0 5L3 3m12 6h5m-5 0V4m0 5l6-6M9 15H4m5 0v5m0-5l-6 6m12-6h5m-5 0v5m0-5l6 6"
            : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
        }
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChartFrame({
  dimensions,
  containerRef,
  title,
  legend,
  children,
  overlay,
  height,
  expandable = true,
}: ChartFrameProps) {
  const { width, height: measuredHeight, margin } = dimensions;
  const { ref, isFullscreen, toggle } = useFullscreen<HTMLDivElement>();

  const restingHeight = height ?? measuredHeight;

  return (
    <div
      ref={ref}
      className={cn(
        "group/chart relative w-full",
        // Fullscreen paints the element itself, not the page behind it,
        // so the background has to be set explicitly or the chart sits
        // on the browser's default black.
        isFullscreen && "flex h-screen flex-col bg-background p-6",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {legend && legend.length >= 2 ? (
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
        ) : (
          <span />
        )}

        {expandable && (
          <ExpandButton
            isFullscreen={isFullscreen}
            onToggle={toggle}
            title={title}
          />
        )}
      </div>

      <div
        ref={containerRef}
        className={cn("relative w-full", isFullscreen && "min-h-0 flex-1")}
        // An explicit height is required: useChartDimensions measures
        // this box, and an auto height would make the SVG size the
        // container that sizes the SVG.
        style={isFullscreen ? undefined : { height: restingHeight }}
      >
        {/* width is 0 until the ResizeObserver reports; skip the paint
            rather than emit a degenerate SVG */}
        {width > 0 && measuredHeight > 0 && (
          <svg
            width={width}
            height={measuredHeight}
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
