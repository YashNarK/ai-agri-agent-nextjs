"use client";

// ============================================================
// components/charts/sparkline.tsx
//
// A small multiple: one indicator, no axes, no legend.
//
// Deliberately minimal. A sparkline answers "which way and how
// steadily", not "what value on what date" — the current value sits
// beside it as text, which is what a reader actually wants at this
// size. Grid and ticks at 40px tall would be noise.
//
// A single series needs no legend: the title names it.
// ============================================================

import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { line as d3Line } from "d3-shape";
import { useMemo } from "react";

import { MARKS } from "./theme";

interface SparklineProps {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  label: string;
}

export function Sparkline({
  values,
  color,
  width = 120,
  height = 36,
  label,
}: SparklineProps) {
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const [min, max] = extent(values) as [number, number];
    const x = scaleLinear().domain([0, values.length - 1]).range([1, width - 1]);
    // pad a flat series so it draws mid-box instead of on the edge
    const y = scaleLinear()
      .domain(min === max ? [min - 1, max + 1] : [min, max])
      .range([height - 2, 2]);

    return (
      d3Line<number>()
        .x((_, i) => x(i))
        .y((d) => y(d))(values) ?? ""
    );
  }, [values, width, height]);

  if (!path) return null;

  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={MARKS.lineWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
