"use client";

// ============================================================
// components/charts/price-history-chart.tsx
//
// Commodity price over time, with traded volume beneath it.
//
// Price and volume are TWO STACKED PANELS SHARING ONE X-AXIS, not one
// chart with two y-axes. A dual-axis chart lets the author choose where
// the two series appear to cross, which invents a relationship the data
// does not contain. Stacked panels keep the time comparison exact and
// each magnitude honestly scaled.
//
// d3 computes scales and path strings; React renders the SVG. The only
// imperative surface is the pointer handler, which reads a coordinate.
// ============================================================

import { bisector, extent, max } from "d3-array";
import { scaleLinear, scaleUtc } from "d3-scale";
import { line as d3Line } from "d3-shape";
import { useCallback, useMemo, useState } from "react";

import { AxisBottom, AxisLeft } from "./primitives/axis";
import { ChartFrame } from "./primitives/chart-frame";
import { ChartTooltip, Crosshair } from "./primitives/tooltip";
import { useChartDimensions } from "./primitives/use-chart-dimensions";
import {
  formatCompact,
  formatMonthYear,
  formatUsd,
  formatUsdPrecise,
  parseIsoDate,
} from "./format";
import { CHROME, MARKS, seriesColor } from "./theme";

export interface PricePoint {
  price_date: string;
  price_usd_tonne: number;
  volume_traded: number | null;
}

interface PriceHistoryChartProps {
  data: PricePoint[];
  cropName: string;
  regionName: string;
  height?: number;
}

/** Share of the total height given to the volume panel. */
const VOLUME_RATIO = 0.26;
const PANEL_GAP = 16;

const PRICE_COLOR = seriesColor(0);
const VOLUME_COLOR = seriesColor(1);

const bisectDate = bisector<{ date: Date }, Date>((d) => d.date).center;

export function PriceHistoryChart({
  data,
  cropName,
  regionName,
  height = 320,
}: PriceHistoryChartProps) {
  const { ref, dimensions } = useChartDimensions<HTMLDivElement>(height);
  const { innerWidth, innerHeight, margin } = dimensions;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // The API returns newest-first for this endpoint; charts draw
  // left-to-right, so sort ascending once here.
  const points = useMemo(
    () =>
      data
        .map((d) => ({
          date: parseIsoDate(d.price_date),
          price: d.price_usd_tonne,
          volume: d.volume_traded ?? 0,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [data],
  );

  const volumeHeight = Math.max(0, innerHeight * VOLUME_RATIO - PANEL_GAP);
  const priceHeight = Math.max(0, innerHeight - volumeHeight - PANEL_GAP);

  const scales = useMemo(() => {
    const [minDate, maxDate] = extent(points, (d) => d.date) as [Date, Date];
    const x = scaleUtc()
      .domain([minDate ?? new Date(), maxDate ?? new Date()])
      .range([0, innerWidth]);

    // Price starts at its own min, not zero: eleven years of commodity
    // prices never approach zero, and anchoring at zero would flatten
    // every real movement into a straight line.
    const [minPrice, maxPrice] = extent(points, (d) => d.price) as [
      number,
      number,
    ];
    const pad = ((maxPrice ?? 1) - (minPrice ?? 0)) * 0.1 || 1;
    const y = scaleLinear()
      .domain([(minPrice ?? 0) - pad, (maxPrice ?? 1) + pad])
      .nice()
      .range([priceHeight, 0]);

    // Volume bars encode magnitude by length, so this one MUST start
    // at zero.
    const yVolume = scaleLinear()
      .domain([0, max(points, (d) => d.volume) ?? 1])
      .nice()
      .range([volumeHeight, 0]);

    return { x, y, yVolume };
  }, [points, innerWidth, priceHeight, volumeHeight]);

  const linePath = useMemo(
    () =>
      d3Line<(typeof points)[number]>()
        .x((d) => scales.x(d.date))
        .y((d) => scales.y(d.price))(points) ?? "",
    [points, scales],
  );

  const barWidth = useMemo(() => {
    if (points.length < 2) return 8;
    const step = innerWidth / points.length;
    return Math.max(1, step - MARKS.gap);
  }, [innerWidth, points.length]);

  const handlePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left - margin.left;
      if (x < 0 || x > innerWidth || points.length === 0) {
        setHoverIndex(null);
        return;
      }
      setHoverIndex(bisectDate(points, scales.x.invert(x)));
    },
    [innerWidth, margin.left, points, scales],
  );

  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No price history for {cropName} in {regionName}.
      </p>
    );
  }

  const active = hoverIndex === null ? null : points[hoverIndex];

  return (
    <div
      onPointerMove={handlePointer}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <ChartFrame
        dimensions={dimensions}
        containerRef={ref}
        title={`Price and traded volume for ${cropName} in ${regionName}`}
        legend={[
          { label: "Price (USD/tonne)", color: PRICE_COLOR },
          { label: "Volume traded", color: VOLUME_COLOR },
        ]}
        overlay={
          active ? (
            <ChartTooltip
              x={scales.x(active.date) + margin.left}
              y={scales.y(active.price) + margin.top}
              containerWidth={dimensions.width}
              title={formatMonthYear(active.date)}
              rows={[
                {
                  label: "Price",
                  value: `${formatUsdPrecise(active.price)}/t`,
                  color: PRICE_COLOR,
                },
                {
                  label: "Volume",
                  value: active.volume ? formatCompact(active.volume) : "—",
                  color: VOLUME_COLOR,
                },
              ]}
            />
          ) : null
        }
      >
        {/* ── price panel ─────────────────────────────────── */}
        <AxisLeft scale={scales.y} innerWidth={innerWidth} format={formatUsd} />
        <path
          d={linePath}
          fill="none"
          stroke={PRICE_COLOR}
          strokeWidth={MARKS.lineWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Crosshair x={active ? scales.x(active.date) : null} innerHeight={priceHeight}>
          {active && (
            <circle
              cx={scales.x(active.date)}
              cy={scales.y(active.price)}
              r={MARKS.dotRadius}
              fill={PRICE_COLOR}
              stroke="var(--card)"
              strokeWidth={MARKS.gap}
            />
          )}
        </Crosshair>

        {/* ── volume panel, sharing the x scale ───────────── */}
        <g transform={`translate(0, ${priceHeight + PANEL_GAP})`}>
          <line
            x1={0}
            x2={innerWidth}
            y1={volumeHeight}
            y2={volumeHeight}
            stroke={CHROME.axis}
            strokeWidth={1}
          />
          {points.map((point, i) => {
            const barHeight = volumeHeight - scales.yVolume(point.volume);
            return (
              <rect
                key={i}
                x={scales.x(point.date) - barWidth / 2}
                y={scales.yVolume(point.volume)}
                width={barWidth}
                height={Math.max(0, barHeight)}
                rx={Math.min(MARKS.barRadius, barWidth / 2)}
                fill={VOLUME_COLOR}
                opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.45}
              />
            );
          })}
          <AxisBottom
            scale={scales.x}
            innerWidth={innerWidth}
            innerHeight={volumeHeight}
            format={(value) => formatMonthYear(value as Date)}
          />
        </g>
      </ChartFrame>
    </div>
  );
}
