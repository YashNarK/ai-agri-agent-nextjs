"use client";

// ============================================================
// components/charts/region-map.tsx
//
// Growing regions on an interactive globe.
//
// ORTHOGRAPHIC, not a flat projection. A globe shows one hemisphere at
// a time, which is a real cost — half the regions are behind the world
// at any moment — and buys the thing a flat map cannot: no area or
// shape distortion, so a region near the pole looks the size it is.
// The cost is paid back by rotating, so the globe opens turned toward
// wherever the data actually is and can be dragged from there.
//
// Country geometry comes from world-atlas' 110m TopoJSON (~105 KB, a
// fraction of that over the wire once compressed) and is decoded in the
// browser. TopoJSON rather than GeoJSON specifically so it can be
// bundled: shared borders are stored once instead of twice, which is
// most of the reason the file is small enough to justify at all.
//
// Points remain points — nothing is shaded by value, because the
// database holds coordinates, not country-level measures.
// ============================================================

import { geoCircle, geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { useCallback, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

import worldTopology from "world-atlas/countries-110m.json";

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

/**
 * The imported JSON is typed structurally by TypeScript, which does not
 * narrow `type: string` to the literals TopoJSON's types require — hence
 * the cast. The target types are the real ones from
 * @types/topojson-specification, so everything downstream stays checked.
 */
type WorldTopology = Topology<{ countries: GeometryCollection }>;

type Rotation = [number, number];

/**
 * Decoded once at module scope, not per mount.
 *
 * The conversion walks every arc in the file; doing it inside the
 * component would repeat that work on every remount of any page showing
 * a map, and the result is immutable.
 */
const WORLD = worldTopology as unknown as WorldTopology;
const COUNTRIES = feature(WORLD, WORLD.objects.countries);

/**
 * A starting rotation that puts the regions in view.
 *
 * Longitudes are averaged as unit vectors rather than arithmetically:
 * the mean of -170° and 170° is 0° by arithmetic — the wrong side of
 * the planet — but 180° as vectors, which is where the data is.
 */
function initialRotation(
  points: { latitude: number; longitude: number }[],
): Rotation {
  if (points.length === 0) return [-10, -20];

  let x = 0;
  let y = 0;
  let latitudeSum = 0;
  for (const point of points) {
    const radians = (point.longitude * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
    latitudeSum += point.latitude;
  }

  const meanLongitude = (Math.atan2(y, x) * 180) / Math.PI;
  const meanLatitude = latitudeSum / points.length;

  // Rotation is the inverse of the point being centred, and the tilt is
  // damped so a dataset sitting near a pole does not spin the globe
  // fully edge-on.
  return [-meanLongitude, -meanLatitude * 0.6];
}

export function RegionMap({
  regions,
  height = 420,
}: {
  regions: MappedRegion[];
  height?: number;
}) {
  const { ref, dimensions } = useChartDimensions<HTMLDivElement>(height, {
    top: 8,
    right: 8,
    bottom: 8,
    left: 8,
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

  const [rotation, setRotation] = useState<Rotation>(() =>
    initialRotation(plotted),
  );

  const { projection, sphere, graticule, countries, shadow } = useMemo(() => {
    const size = Math.min(innerWidth || 1, innerHeight || 1);
    const projection = geoOrthographic()
      .rotate([rotation[0], rotation[1]])
      // fitSize on the sphere would fill the box's shorter axis and then
      // sit against one edge; centring by hand keeps the globe in the
      // middle of a box that is almost always wider than it is tall.
      .fitSize([size, size], { type: "Sphere" })
      .translate([(innerWidth || 1) / 2, (innerHeight || 1) / 2]);

    const path = geoPath(projection);

    return {
      projection,
      sphere: path({ type: "Sphere" }) ?? "",
      graticule: path(geoGraticule10()) ?? "",
      countries: COUNTRIES.features.map((f) => path(f) ?? ""),
      // A soft terminator arc, drawn just inside the limb, so the sphere
      // reads as a ball rather than a flat disc.
      shadow: path(geoCircle().center([-rotation[0], -rotation[1]]).radius(88)()) ?? "",
    };
  }, [innerWidth, innerHeight, rotation]);

  /** Great-circle centre currently facing the viewer. */
  const centre = useMemo(
    (): [number, number] => [-rotation[0], -rotation[1]],
    [rotation],
  );

  const isVisible = useCallback(
    (longitude: number, latitude: number) =>
      geoDistance([longitude, latitude], centre) < Math.PI / 2,
    [centre],
  );

  // ── drag to rotate ──────────────────────────────────────────
  const drag = useRef<{ x: number; y: number; rotation: Rotation } | null>(null);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, rotation };
    setHover(null);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    // Degrees per pixel scaled to the globe's radius, so dragging feels
    // the same whether the map is rendered large or small.
    const sensitivity = 75 / (projection.scale() || 1);
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    setRotation([
      drag.current.rotation[0] + dx * sensitivity,
      // Clamped: past ±90° the globe flips through the pole, which is
      // disorienting rather than useful.
      Math.max(-90, Math.min(90, drag.current.rotation[1] - dy * sensitivity)),
    ]);
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };

  const hidden = plotted.filter(
    (region) => !isVisible(region.longitude, region.latitude),
  ).length;

  return (
    <div className="w-full">
      <div ref={ref} className="relative w-full">
        {innerWidth > 0 && (
          <svg
            width={dimensions.width}
            height={height}
            role="img"
            aria-label={`Globe showing ${plotted.length} growing regions; drag to rotate`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            // cursor via CSS state rather than the drag ref: reading a
            // ref during render is both a lint error and a correctness
            // trap, since changing it does not re-render anyway.
            className="cursor-grab active:cursor-grabbing"
            style={{ touchAction: "none" }}
          >
            <g transform={`translate(${margin.left}, ${margin.top})`}>
              {/* ocean */}
              <path d={sphere} fill="var(--muted)" fillOpacity={0.45} />

              {/* graticule under the land, so it reads as a wireframe
                  the continents sit on rather than a grid drawn over them */}
              <path
                d={graticule}
                fill="none"
                stroke={CHROME.grid}
                strokeWidth={0.4}
                strokeOpacity={0.7}
              />

              {countries.map((d, index) => (
                <path
                  key={index}
                  d={d}
                  fill="var(--card)"
                  fillOpacity={0.92}
                  stroke={CHROME.axis}
                  strokeWidth={0.4}
                  strokeOpacity={0.55}
                />
              ))}

              {/* limb shading, then the outline on top */}
              <path d={shadow} fill="var(--foreground)" fillOpacity={0.04} />
              <path d={sphere} fill="none" stroke={CHROME.axis} strokeWidth={1} />

              {plotted.map((region) => {
                if (!isVisible(region.longitude, region.latitude)) return null;
                const projected = projection([region.longitude, region.latitude]);
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
                    onPointerEnter={() => !drag.current && setHover(region)}
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

      <p className="mt-2 text-xs text-muted-foreground">
        Drag the globe to rotate.
        {hidden > 0 && ` ${hidden} region${hidden === 1 ? " is" : "s are"} on the far side.`}
        {plotted.length < regions.length &&
          ` ${regions.length - plotted.length} region${
            regions.length - plotted.length === 1 ? "" : "s"
          } without coordinates ${
            regions.length - plotted.length === 1 ? "is" : "are"
          } not shown.`}
      </p>
    </div>
  );
}
