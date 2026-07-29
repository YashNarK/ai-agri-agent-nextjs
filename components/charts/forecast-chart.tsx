"use client";

// ============================================================
// components/charts/forecast-chart.tsx
//
// Recent price history with a logged forecast and its confidence
// interval placed on the same time axis.
//
// The interval is drawn as a band behind the point rather than error
// bars: at this size a band reads as "the answer lives in here", which
// is the honest reading of a prediction interval, while whiskers invite
// the eye to treat the centre as the answer and the ends as noise.
//
// History and forecast are the SAME measure in the SAME units, so they
// legitimately share one y-scale. The dashed segment between them marks
// where observation stops and extrapolation begins.
// ============================================================

import { extent } from "d3-array";
import { scaleLinear, scaleUtc } from "d3-scale";
import { line as d3Line } from "d3-shape";
import { useMemo } from "react";

import { formatMonthYear, formatUsd, formatUsdPrecise, parseIsoDate } from "./format";
import { AxisBottom, AxisLeft } from "./primitives/axis";
import { ChartFrame } from "./primitives/chart-frame";
import { useChartDimensions } from "./primitives/use-chart-dimensions";
import { MARKS, seriesColor } from "./theme";

export interface ForecastHistoryPoint {
  price_date: string;
  price_usd_tonne: number;
}

export interface ForecastMark {
  target_date: string;
  predicted_price: number;
  confidence_low: number | null;
  confidence_high: number | null;
}

interface ForecastChartProps {
  history: ForecastHistoryPoint[];
  forecast: ForecastMark;
  cropName: string;
  regionName: string;
  height?: number;
}

const HISTORY_COLOR = seriesColor(0); // blue
const FORECAST_COLOR = seriesColor(1); // orange

export function ForecastChart({
  history,
  forecast,
  cropName,
  regionName,
  height = 300,
}: ForecastChartProps) {
  const { ref, dimensions } = useChartDimensions<HTMLDivElement>(height);
  const { innerWidth, innerHeight } = dimensions;

  const model = useMemo(() => {
    const points = history
      .map((d) => ({
        date: parseIsoDate(d.price_date),
        price: d.price_usd_tonne,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const target = parseIsoDate(forecast.target_date);
    const low = forecast.confidence_low ?? forecast.predicted_price;
    const high = forecast.confidence_high ?? forecast.predicted_price;

    const dates = [...points.map((p) => p.date), target];
    const values = [...points.map((p) => p.price), low, high];

    const [minDate, maxDate] = extent(dates) as [Date, Date];
    const [minValue, maxValue] = extent(values) as [number, number];
    const pad = ((maxValue ?? 1) - (minValue ?? 0)) * 0.12 || 1;

    const x = scaleUtc()
      .domain([minDate ?? new Date(), maxDate ?? new Date()])
      .range([0, innerWidth]);
    const y = scaleLinear()
      .domain([(minValue ?? 0) - pad, (maxValue ?? 1) + pad])
      .nice()
      .range([innerHeight, 0]);

    return { points, target, low, high, x, y };
  }, [history, forecast, innerWidth, innerHeight]);

  const { points, target, low, high, x, y } = model;

  const historyPath = useMemo(
    () =>
      d3Line<(typeof points)[number]>()
        .x((d) => x(d.date))
        .y((d) => y(d.price))(points) ?? "",
    [points, x, y],
  );

  if (points.length === 0) return null;

  const last = points[points.length - 1];
  const bandTop = y(high);
  const bandHeight = Math.max(2, y(low) - y(high));
  const bandWidth = 22;

  return (
    <ChartFrame
      dimensions={dimensions}
      containerRef={ref}
      title={`Price history and forecast for ${cropName} in ${regionName}`}
      legend={[
        { label: "Observed price", color: HISTORY_COLOR },
        { label: "Forecast (95% interval)", color: FORECAST_COLOR },
      ]}
    >
      <AxisLeft scale={y} innerWidth={innerWidth} format={formatUsd} />
      <AxisBottom
        scale={x}
        innerWidth={innerWidth}
        innerHeight={innerHeight}
        format={(v) => formatMonthYear(v as Date)}
      />

      <path
        d={historyPath}
        fill="none"
        stroke={HISTORY_COLOR}
        strokeWidth={MARKS.lineWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* the gap between last observation and forecast, dashed so the
          transition from measured to modelled is visible */}
      <line
        x1={x(last.date)}
        y1={y(last.price)}
        x2={x(target)}
        y2={y(forecast.predicted_price)}
        stroke={FORECAST_COLOR}
        strokeWidth={MARKS.lineWidth}
        strokeDasharray="4 4"
      />

      <rect
        x={x(target) - bandWidth / 2}
        y={bandTop}
        width={bandWidth}
        height={bandHeight}
        rx={MARKS.barRadius}
        fill={FORECAST_COLOR}
        opacity={MARKS.bandOpacity}
      />

      <circle
        cx={x(target)}
        cy={y(forecast.predicted_price)}
        r={MARKS.dotRadius + 1}
        fill={FORECAST_COLOR}
        stroke="var(--card)"
        strokeWidth={MARKS.gap}
      />

      {/* Direct label rather than a tooltip: this is the one value the
          chart exists to communicate, so it should not need a hover. */}
      <text
        x={x(target)}
        y={bandTop - 8}
        textAnchor="end"
        className="fill-foreground"
        style={{ fontSize: 12, fontWeight: 600 }}
      >
        {formatUsdPrecise(forecast.predicted_price)}
      </text>
    </ChartFrame>
  );
}
