"use client";

// ============================================================
// components/charts/region-map.tsx
//
// Growing regions plotted by latitude and longitude.
//
// WHAT THIS IS AND ISN'T. There is no country geometry here: the
// database stores points, not borders, and shipping a world TopoJSON
// would add a payload the data does not justify. So this draws the
// globe outline and a graticule for orientation and places the regions
// on it — an honest point map, not a choropleth. Nothing is shaded by
// value, because nothing here is measured per country.
//
// Natural Earth projection: compromise distortion, so relative
// positions read sensibly at world scale without the area exaggeration
// Mercator introduces at high latitudes.
// ============================================================

import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { useMemo, useState } from "react";

import { useChartDimensions } from "./primitives/use-chart-dimensions";
import { ChartTooltip } from "./primitives/tooltip";
import { CHROME, MARKS, seriesColor } from "./theme";

export interface MappedRegion {
  code: string;
  name: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

const POINT_COLOR = seriesColor(0);

export function RegionMap({
  regions,
  height = 380,
}: {
  regions: MappedRegion[];
  height?: number;
}) {
  const { ref, dimensions } = useChartDimensions<HTMLDivElement>(height, {
    top: 4,
    right: 4,
    bottom: 4,
    left: 4,
  });
  const { innerWidth, innerHeight, margin } = dimensions;
  const [hover, setHover] = useState<MappedRegion | null>(null);

  const plotted = useMemo(
    () =>
      regions.filter(
        (r): r is MappedRegion & { latitude: number; longitude: number } =>
          r.latitude !== null && r.longitude !== null,
      ),
    [regions],
  );

  const { projection, sphere, graticule } = useMemo(() => {
    const projection = geoNaturalEarth1().fitSize(
      [innerWidth || 1, innerHeight || 1],
      { type: "Sphere" },
    );
    // the path generator is only needed to produce these two strings —
    // points are projected directly, so it does not escape the memo
    const path = geoPath(projection);
    return {
      projection,
      sphere: path({ type: "Sphere" }) ?? "",
      graticule: path(geoGraticule10()) ?? "",
    };
  }, [innerWidth, innerHeight]);

  return (
    <div className="w-full">
      <div ref={ref} className="relative w-full">
        {innerWidth > 0 && (
          <svg
            width={dimensions.width}
            height={height}
            role="img"
            aria-label={`World map showing ${plotted.length} growing regions`}
          >
            <g transform={`translate(${margin.left}, ${margin.top})`}>
              <path d={sphere} fill="var(--muted)" fillOpacity={0.35} />
              <path
                d={graticule}
                fill="none"
                stroke={CHROME.grid}
                strokeWidth={0.5}
              />
              <path
                d={sphere}
                fill="none"
                stroke={CHROME.axis}
                strokeWidth={1}
              />

              {plotted.map((region) => {
                const projected = projection([
                  region.longitude,
                  region.latitude,
                ]);
                if (!projected) return null;
                const [cx, cy] = projected;
                const active = hover?.code === region.code;
                return (
                  <circle
                    key={region.code}
                    cx={cx}
                    cy={cy}
                    r={active ? MARKS.dotRadius + 2 : MARKS.dotRadius}
                    fill={POINT_COLOR}
                    stroke="var(--card)"
                    strokeWidth={MARKS.gap}
                    onPointerEnter={() => setHover(region)}
                    onPointerLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
            </g>
          </svg>
        )}

        {hover &&
          (() => {
            const projected = projection([
              hover.longitude as number,
              hover.latitude as number,
            ]);
            if (!projected) return null;
            return (
              <ChartTooltip
                x={projected[0] + margin.left}
                y={projected[1] + margin.top}
                containerWidth={dimensions.width}
                title={hover.name}
                rows={[
                  { label: "Country", value: hover.country },
                  { label: "Code", value: hover.code },
                ]}
              />
            );
          })()}
      </div>

      {plotted.length < regions.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          {regions.length - plotted.length} region
          {regions.length - plotted.length === 1 ? "" : "s"} without
          coordinates {regions.length - plotted.length === 1 ? "is" : "are"} not
          shown.
        </p>
      )}
    </div>
  );
}
