"use client";

// ============================================================
// components/charts/primitives/axis.tsx
//
// Axes and gridlines rendered as JSX.
//
// d3 supplies the tick VALUES via scale.ticks(); React renders them.
// We deliberately do not use d3-axis, which works by appending nodes to
// a selection — that fights reconciliation and puts DOM outside React's
// control. Asking the scale for ticks keeps d3 doing maths only.
//
// Chrome is recessive: hairline grid, muted labels, no axis domain line
// on the value axis (the gridlines already imply it).
// ============================================================

import { CHROME } from "@/components/charts/theme";

interface ScaleLike {
  (value: never): number;
  ticks?: (count?: number) => unknown[];
  domain: () => unknown[];
  range: () => number[];
  bandwidth?: () => number;
}

interface AxisProps {
  scale: ScaleLike;
  innerWidth: number;
  innerHeight: number;
  tickCount?: number;
  format?: (value: never) => string;
}

const LABEL_STYLE: React.CSSProperties = {
  fill: CHROME.muted,
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
};

/**
 * Roughly the width one x-axis label needs before its neighbour starts
 * touching it. Sized for the longest thing we print down there — a
 * month-and-year stamp like "Jan 2026" at 11px.
 */
const MIN_TICK_SPACING = 78;

/** Horizontal axis with ticks along the bottom of the plot. */
export function AxisBottom({
  scale,
  innerWidth,
  innerHeight,
  tickCount = 6,
  format,
}: AxisProps) {
  // Ask for fewer ticks when there is no room for them.
  //
  // `tickCount` is a request, not a promise — d3 returns a nice round
  // interval near it — but six date labels in a 330px plot overlapped
  // into an unreadable smear on a phone. Deriving a ceiling from the
  // actual plot width means the same chart thins its axis as it narrows,
  // rather than every caller hard-coding a number that only suits a
  // desktop. Never below two, or the axis stops conveying a range.
  const affordable = Math.max(2, Math.floor(innerWidth / MIN_TICK_SPACING));
  const ticks = (scale.ticks?.(Math.min(tickCount, affordable)) ??
    scale.domain()) as never[];
  const offset = scale.bandwidth ? scale.bandwidth() / 2 : 0;

  return (
    <g transform={`translate(0, ${innerHeight})`} aria-hidden="true">
      <line
        x1={0}
        x2={scale.range()[1]}
        y1={0}
        y2={0}
        stroke={CHROME.axis}
        strokeWidth={1}
      />
      {ticks.map((tick, i) => (
        <text
          key={i}
          x={scale(tick) + offset}
          y={16}
          textAnchor="middle"
          style={LABEL_STYLE}
        >
          {format ? format(tick) : String(tick)}
        </text>
      ))}
    </g>
  );
}

/** Value axis: gridlines plus left-hand labels, no domain line. */
export function AxisLeft({
  scale,
  innerWidth,
  tickCount = 5,
  format,
}: Omit<AxisProps, "innerHeight">) {
  const ticks = (scale.ticks?.(tickCount) ?? scale.domain()) as never[];

  return (
    <g aria-hidden="true">
      {ticks.map((tick, i) => {
        const y = scale(tick);
        return (
          <g key={i} transform={`translate(0, ${y})`}>
            <line
              x1={0}
              x2={innerWidth}
              stroke={CHROME.grid}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={-8} y={4} textAnchor="end" style={LABEL_STYLE}>
              {format ? format(tick) : String(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
