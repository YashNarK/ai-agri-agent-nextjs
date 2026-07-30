"use client";

// ============================================================
// components/charts/yield-scatter.tsx
//
// Yield against harvested area, one dot per harvest year, coloured by
// region and sized by total production.
//
// SERIES CAP. In a scatter every mark can end up adjacent to every
// other, so the palette must clear its separation floors across ALL
// pairs, not just neighbouring slots. Validation showed only the first
// three slots do that in both themes — past three, yellow lands beside
// orange and the pair fails. So the three regions with the most
// observations get colours and the remainder folds into a neutral
// "Other", which is exactly the documented remedy. Silently cycling
// hues would produce a chart nobody can decode.
//
// Both axes start at zero: position here encodes magnitude, and a
// trimmed origin would misrepresent the ratios the chart exists to show.
// ============================================================

import { max } from "d3-array";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { useMemo, useState } from "react";

import { formatCompact, formatDecimal } from "./format";
import { AxisBottom, AxisLeft } from "./primitives/axis";
import { ChartFrame } from "./primitives/chart-frame";
import { ChartTooltip } from "./primitives/tooltip";
import { useChartDimensions } from "./primitives/use-chart-dimensions";
import { CHROME, MARKS, SERIES_CAP_ALL_PAIRS, seriesColor } from "./theme";

export interface YieldPoint {
  region_code: string;
  region_name: string;
  harvest_year: number;
  yield_tonnes_ha: number;
  area_harvested_ha: number | null;
  total_production_tonnes: number | null;
}

interface YieldScatterProps {
  data: YieldPoint[];
  cropName: string;
  height?: number;
}

const OTHER = "Other";

export function YieldScatter({ data, cropName, height = 340 }: YieldScatterProps) {
  const { ref, dimensions } = useChartDimensions<HTMLDivElement>(height, {
    left: 56,
    bottom: 36,
  });
  const { innerWidth, innerHeight, margin } = dimensions;
  const [hover, setHover] = useState<YieldPoint | null>(null);

  const { points, groups, colorOf } = useMemo(() => {
    const usable = data.filter((d) => d.area_harvested_ha !== null);

    // rank regions by how much data they contribute, so the coloured
    // slots go to the ones a reader will actually care about
    const counts = new Map<string, number>();
    for (const d of usable) {
      counts.set(d.region_code, (counts.get(d.region_code) ?? 0) + 1);
    }
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);

    const named = ranked.slice(0, SERIES_CAP_ALL_PAIRS);
    const hasOther = ranked.length > named.length;

    const colorOf = (regionCode: string) => {
      const index = named.indexOf(regionCode);
      // identity, not rank: a region keeps its colour regardless of how
      // the list is later sorted or filtered
      return index === -1 ? CHROME.muted : seriesColor(index);
    };

    const groups = [
      ...named.map((code) => ({
        label: usable.find((d) => d.region_code === code)?.region_name ?? code,
        color: colorOf(code),
      })),
      ...(hasOther
        ? [{ label: `${OTHER} (${ranked.length - named.length} regions)`, color: CHROME.muted }]
        : []),
    ];

    return { points: usable, groups, colorOf };
  }, [data]);

  const scales = useMemo(() => {
    const x = scaleLinear()
      .domain([0, max(points, (d) => d.area_harvested_ha ?? 0) ?? 1])
      .nice()
      .range([0, innerWidth]);
    const y = scaleLinear()
      .domain([0, max(points, (d) => d.yield_tonnes_ha) ?? 1])
      .nice()
      .range([innerHeight, 0]);
    // sqrt so AREA encodes production — a linear radius would
    // exaggerate large values by the square
    const r = scaleSqrt()
      .domain([0, max(points, (d) => d.total_production_tonnes ?? 0) ?? 1])
      .range([MARKS.dotRadius, 18]);
    return { x, y, r };
  }, [points, innerWidth, innerHeight]);

  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No yield records with harvested area for {cropName}.
      </p>
    );
  }

  return (
    <ChartFrame
      dimensions={dimensions}
      containerRef={ref}
      height={height}
      title={`Yield against harvested area for ${cropName}, by region`}
      legend={groups}
      overlay={
        hover ? (
          <ChartTooltip
            x={scales.x(hover.area_harvested_ha ?? 0) + margin.left}
            y={scales.y(hover.yield_tonnes_ha) + margin.top}
            containerWidth={dimensions.width}
            title={`${hover.region_name} · ${hover.harvest_year}`}
            rows={[
              {
                label: "Yield",
                value: `${formatDecimal(hover.yield_tonnes_ha)} t/ha`,
                color: colorOf(hover.region_code),
              },
              {
                label: "Area",
                value: `${formatCompact(hover.area_harvested_ha ?? 0)} ha`,
              },
              {
                label: "Production",
                value: hover.total_production_tonnes
                  ? `${formatCompact(hover.total_production_tonnes)} t`
                  : "—",
              },
            ]}
          />
        ) : null
      }
    >
      <AxisLeft
        scale={scales.y}
        innerWidth={innerWidth}
        format={(v) => formatDecimal(v as number)}
      />
      <AxisBottom
        scale={scales.x}
        innerWidth={innerWidth}
        innerHeight={innerHeight}
        format={(v) => formatCompact(v as number)}
      />

      <text
        x={innerWidth}
        y={innerHeight + 32}
        textAnchor="end"
        style={{ fill: CHROME.muted, fontSize: 11 }}
      >
        Harvested area (ha) →
      </text>
      <text
        x={0}
        y={-2}
        style={{ fill: CHROME.muted, fontSize: 11 }}
      >
        Yield (t/ha)
      </text>

      {points.map((point, i) => (
        <circle
          key={`${point.region_code}-${point.harvest_year}-${i}`}
          cx={scales.x(point.area_harvested_ha ?? 0)}
          cy={scales.y(point.yield_tonnes_ha)}
          r={scales.r(point.total_production_tonnes ?? 0)}
          fill={colorOf(point.region_code)}
          fillOpacity={0.7}
          // a surface-coloured ring keeps overlapping marks readable
          stroke="var(--card)"
          strokeWidth={MARKS.gap}
          onPointerEnter={() => setHover(point)}
          onPointerLeave={() => setHover(null)}
        />
      ))}
    </ChartFrame>
  );
}
