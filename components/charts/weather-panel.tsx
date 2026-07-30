"use client";

// ============================================================
// components/charts/weather-panel.tsx
//
// Temperature, rainfall and drought index over time.
//
// THREE measures in three different units, so three stacked panels
// sharing one x-axis — never three y-scales on one plot. Small
// multiples keep every vertical comparison honest: the reader compares
// dates across panels, and magnitudes only within a panel.
//
// The temperature panel draws a min/max BAND with the mean on top: the
// daily range is the meaningful quantity, and a band shows it without
// three competing lines.
// ============================================================

import { extent, max } from "d3-array";
import { scaleLinear, scaleUtc } from "d3-scale";
import { area as d3Area, line as d3Line } from "d3-shape";
import { useMemo } from "react";

import { formatDecimal, formatMonthYear, parseIsoDate } from "./format";
import { AxisBottom, AxisLeft } from "./primitives/axis";
import { ExpandButton } from "./primitives/chart-frame";
import { useChartDimensions } from "./primitives/use-chart-dimensions";
import { useFullscreen } from "./primitives/use-fullscreen";
import { CHROME, MARKS, seriesColor } from "./theme";
import { cn } from "@/lib/utils";

export interface WeatherPoint {
  weather_date: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
  temp_avg_c: number | null;
  rainfall_mm: number | null;
  drought_index: number | null;
}

interface WeatherPanelProps {
  data: WeatherPoint[];
  regionName: string;
  height?: number;
}

const TEMP_COLOR = seriesColor(1); // orange
const RAIN_COLOR = seriesColor(0); // blue
const DROUGHT_COLOR = seriesColor(3); // yellow

const PANEL_GAP = 22;

export function WeatherPanel({
  data,
  regionName,
  height = 420,
}: WeatherPanelProps) {
  const { ref, dimensions } = useChartDimensions<HTMLDivElement>(height);
  const { innerWidth, innerHeight, margin } = dimensions;
  const {
    ref: fullscreenRef,
    isFullscreen,
    toggle,
  } = useFullscreen<HTMLDivElement>();

  const points = useMemo(
    () =>
      data
        .map((d) => ({
          date: parseIsoDate(d.weather_date),
          min: d.temp_min_c,
          max: d.temp_max_c,
          avg: d.temp_avg_c,
          rain: d.rainfall_mm ?? 0,
          drought: d.drought_index,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [data],
  );

  const panelHeight = Math.max(0, (innerHeight - PANEL_GAP * 2) / 3);

  const scales = useMemo(() => {
    const [minDate, maxDate] = extent(points, (d) => d.date) as [Date, Date];
    const x = scaleUtc()
      .domain([minDate ?? new Date(), maxDate ?? new Date()])
      .range([0, innerWidth]);

    const temps = points.flatMap((p) =>
      [p.min, p.max, p.avg].filter((v): v is number => v !== null),
    );
    const [tMin, tMax] = extent(temps) as [number, number];
    const yTemp = scaleLinear()
      .domain([tMin ?? 0, tMax ?? 1])
      .nice()
      .range([panelHeight, 0]);

    // rainfall is a magnitude encoded by bar length — zero baseline
    const yRain = scaleLinear()
      .domain([0, max(points, (p) => p.rain) ?? 1])
      .nice()
      .range([panelHeight, 0]);

    const yDrought = scaleLinear()
      .domain([0, max(points, (p) => p.drought ?? 0) ?? 1])
      .nice()
      .range([panelHeight, 0]);

    return { x, yTemp, yRain, yDrought };
  }, [points, innerWidth, panelHeight]);

  const tempBand = useMemo(() => {
    const withRange = points.filter((p) => p.min !== null && p.max !== null);
    return (
      d3Area<(typeof withRange)[number]>()
        .x((d) => scales.x(d.date))
        .y0((d) => scales.yTemp(d.min as number))
        .y1((d) => scales.yTemp(d.max as number))(withRange) ?? ""
    );
  }, [points, scales]);

  const tempLine = useMemo(() => {
    const withAvg = points.filter((p) => p.avg !== null);
    return (
      d3Line<(typeof withAvg)[number]>()
        .x((d) => scales.x(d.date))
        .y((d) => scales.yTemp(d.avg as number))(withAvg) ?? ""
    );
  }, [points, scales]);

  const droughtLine = useMemo(() => {
    const withDrought = points.filter((p) => p.drought !== null);
    return (
      d3Line<(typeof withDrought)[number]>()
        .x((d) => scales.x(d.date))
        .y((d) => scales.yDrought(d.drought as number))(withDrought) ?? ""
    );
  }, [points, scales]);

  const barWidth = points.length
    ? Math.max(1, innerWidth / points.length - MARKS.gap)
    : 4;

  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No weather observations for {regionName}.
      </p>
    );
  }

  return (
    <div
      ref={fullscreenRef}
      className={cn(
        "group/chart w-full",
        isFullscreen && "flex h-screen flex-col bg-background p-6",
      )}
    >
      {/* Each panel is titled rather than legended: one measure per
          panel means the title alone identifies the series */}
      <div className="flex justify-end">
        <ExpandButton
          isFullscreen={isFullscreen}
          onToggle={toggle}
          title={`Weather for ${regionName}`}
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
            aria-label={`Temperature, rainfall and drought index for ${regionName}`}
          >
            <g transform={`translate(${margin.left}, ${margin.top})`}>
              {/* ── temperature ───────────────────────────── */}
              <PanelLabel y={-2}>Temperature (°C), daily range and mean</PanelLabel>
              <AxisLeft
                scale={scales.yTemp}
                innerWidth={innerWidth}
                tickCount={4}
                format={(v) => formatDecimal(v as number)}
              />
              <path d={tempBand} fill={TEMP_COLOR} opacity={MARKS.bandOpacity} />
              <path
                d={tempLine}
                fill="none"
                stroke={TEMP_COLOR}
                strokeWidth={MARKS.lineWidth}
                strokeLinejoin="round"
              />

              {/* ── rainfall ──────────────────────────────── */}
              <g transform={`translate(0, ${panelHeight + PANEL_GAP})`}>
                <PanelLabel y={-2}>Rainfall (mm)</PanelLabel>
                <AxisLeft
                  scale={scales.yRain}
                  innerWidth={innerWidth}
                  tickCount={3}
                  format={(v) => formatDecimal(v as number)}
                />
                {points.map((p, i) => (
                  <rect
                    key={i}
                    x={scales.x(p.date) - barWidth / 2}
                    y={scales.yRain(p.rain)}
                    width={barWidth}
                    height={Math.max(0, panelHeight - scales.yRain(p.rain))}
                    rx={Math.min(MARKS.barRadius, barWidth / 2)}
                    fill={RAIN_COLOR}
                  />
                ))}
              </g>

              {/* ── drought index ─────────────────────────── */}
              <g transform={`translate(0, ${(panelHeight + PANEL_GAP) * 2})`}>
                <PanelLabel y={-2}>Drought index</PanelLabel>
                <AxisLeft
                  scale={scales.yDrought}
                  innerWidth={innerWidth}
                  tickCount={3}
                  format={(v) => formatDecimal(v as number)}
                />
                <path
                  d={droughtLine}
                  fill="none"
                  stroke={DROUGHT_COLOR}
                  strokeWidth={MARKS.lineWidth}
                  strokeLinejoin="round"
                />
                <AxisBottom
                  scale={scales.x}
                  innerWidth={innerWidth}
                  innerHeight={panelHeight}
                  format={(v) => formatMonthYear(v as Date)}
                />
              </g>
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

function PanelLabel({ y, children }: { y: number; children: string }) {
  return (
    <text x={0} y={y} style={{ fill: CHROME.muted, fontSize: 11 }}>
      {children}
    </text>
  );
}
