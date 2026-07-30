"use client";

// ============================================================
// components/charts/seasonality-heatmap.tsx
//
// Price by month (x) and year (y) — makes seasonal structure visible in
// a way a single long line cannot: recurring highs line up vertically.
//
// SEQUENTIAL encoding, so it is ONE hue running light to dark. Never a
// rainbow: with multiple hues the reader has to consult the legend to
// order two cells, whereas a single-hue ramp is ordered by lightness,
// which needs no lookup and survives colourblindness.
// ============================================================

import { extent } from "d3-array";
import { scaleQuantize } from "d3-scale";
import { useMemo, useState } from "react";

import { formatUsdPrecise, parseIsoDate } from "./format";
import { ChartTypeLabel, ExpandButton } from "./primitives/chart-frame";
import { ChartTooltip } from "./primitives/tooltip";
import { useChartDimensions } from "./primitives/use-chart-dimensions";
import { expandedClasses, useFullscreen } from "./primitives/use-fullscreen";
import { cn } from "@/lib/utils";
import { CHROME, MARKS, SEQUENTIAL } from "./theme";

export interface SeasonalityPoint {
  price_date: string;
  price_usd_tonne: number;
}

interface SeasonalityHeatmapProps {
  data: SeasonalityPoint[];
  height?: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface Cell {
  year: number;
  month: number;
  price: number;
}

export function SeasonalityHeatmap({
  data,
  height = 300,
}: SeasonalityHeatmapProps) {
  const { ref, dimensions } = useChartDimensions<HTMLDivElement>(height, {
    left: 44,
    bottom: 24,
    top: 8,
  });
  const { innerWidth, innerHeight, margin } = dimensions;
  const [hover, setHover] = useState<Cell | null>(null);
  const {
    ref: fullscreenRef,
    isFullscreen,
    isOverlay,
    toggle,
  } = useFullscreen<HTMLDivElement>();

  const { cells, years, colorScale } = useMemo(() => {
    const cells: Cell[] = data.map((d) => {
      const date = parseIsoDate(d.price_date);
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        price: d.price_usd_tonne,
      };
    });

    const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => b - a);
    const [min, max] = extent(cells, (c) => c.price) as [number, number];

    // quantize rather than a continuous interpolator: the ramp is five
    // named CSS steps that swap with the theme, so we map into those
    // rather than computing colours d3 would have to resolve itself
    const colorScale = scaleQuantize<string>()
      .domain([min ?? 0, max ?? 1])
      .range([...SEQUENTIAL]);

    return { cells, years, colorScale };
  }, [data]);

  if (cells.length === 0) return null;

  const cellWidth = innerWidth / 12;
  const cellHeight = years.length > 0 ? innerHeight / years.length : 0;

  return (
    <div
      ref={fullscreenRef}
      className={cn("group/chart w-full", expandedClasses(isFullscreen, isOverlay))}
    >
      {/* A dense month × year matrix where colour, not position, carries
          the measure — and the cyclical month axis is what makes it a
          seasonality plot rather than a generic heatmap. */}
      <ChartTypeLabel>Heatmap (month × year seasonality matrix)</ChartTypeLabel>

      {/* Continuous legend — a sequential scale is ordered by lightness,
          so it needs a low/high anchor rather than a keyed list */}
      <div className="mt-1 mb-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Lower</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full">
          {SEQUENTIAL.map((step) => (
            <span key={step} className="flex-1" style={{ background: step }} />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Higher</span>
        <ExpandButton
          isFullscreen={isFullscreen}
          onToggle={toggle}
          title="Seasonality heatmap"
        />
      </div>

      <div
        ref={ref}
        className={cn("relative w-full", isFullscreen && "min-h-0 flex-1")}
        style={isFullscreen ? undefined : { height }}
      >
        {dimensions.width > 0 && (
          <svg
            width={dimensions.width}
            height={dimensions.height}
            role="img"
            aria-label="Price by month and year"
          >
            <g transform={`translate(${margin.left}, ${margin.top})`}>
              {years.map((year, rowIndex) => (
                <text
                  key={year}
                  x={-8}
                  y={rowIndex * cellHeight + cellHeight / 2 + 4}
                  textAnchor="end"
                  style={{
                    fill: CHROME.muted,
                    fontSize: 11,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {year}
                </text>
              ))}

              {cells.map((cell) => {
                const rowIndex = years.indexOf(cell.year);
                const isHovered =
                  hover?.year === cell.year && hover?.month === cell.month;
                return (
                  <rect
                    key={`${cell.year}-${cell.month}`}
                    x={cell.month * cellWidth + MARKS.gap / 2}
                    y={rowIndex * cellHeight + MARKS.gap / 2}
                    width={Math.max(0, cellWidth - MARKS.gap)}
                    height={Math.max(0, cellHeight - MARKS.gap)}
                    rx={2}
                    fill={colorScale(cell.price)}
                    stroke={isHovered ? "var(--foreground)" : "none"}
                    strokeWidth={1.5}
                    onPointerEnter={() => setHover(cell)}
                    onPointerLeave={() => setHover(null)}
                  />
                );
              })}

              {MONTHS.map((label, i) => (
                <text
                  key={label}
                  x={i * cellWidth + cellWidth / 2}
                  y={innerHeight + 16}
                  textAnchor="middle"
                  style={{ fill: CHROME.muted, fontSize: 11 }}
                >
                  {label}
                </text>
              ))}
            </g>
          </svg>
        )}

        {hover && (
          <ChartTooltip
            x={hover.month * cellWidth + cellWidth / 2 + margin.left}
            y={years.indexOf(hover.year) * cellHeight + margin.top}
            containerWidth={dimensions.width}
            title={`${MONTHS[hover.month]} ${hover.year}`}
            rows={[
              { label: "Price", value: `${formatUsdPrecise(hover.price)}/t` },
            ]}
          />
        )}
      </div>
    </div>
  );
}
