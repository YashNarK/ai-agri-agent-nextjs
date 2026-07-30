"use client";

// ============================================================
// components/charts/primitives/use-chart-dimensions.ts
//
// Measures the container so charts size themselves to whatever box
// they're dropped into — a dashboard grid cell, a card, or a chat
// bubble. Returns the inner plot box with margins already subtracted,
// so chart bodies never repeat the arithmetic.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const DEFAULT_MARGIN: ChartMargin = {
  top: 12,
  right: 16,
  bottom: 28,
  left: 48,
};

export interface ChartDimensions {
  width: number;
  height: number;
  margin: ChartMargin;
  /** Plot area, margins removed. Never negative. */
  innerWidth: number;
  innerHeight: number;
}

/**
 * `height` is the RESTING height only. The element is measured in both
 * axes, so whatever renders it — ChartFrame, say, while expanded to
 * fullscreen — can give the container a different height and the scales
 * follow without the chart knowing anything about it.
 *
 * This depends on the container having an explicit CSS height. With an
 * auto height the SVG would size the container and the container would
 * size the SVG, which oscillates. ChartFrame sets it; a chart rendering
 * its own SVG must do the same.
 */
export function useChartDimensions<T extends HTMLElement = HTMLDivElement>(
  height = 260,
  margin: Partial<ChartMargin> = {},
) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(height);

  // margin is typically an inline literal, so memo on its values rather
  // than its identity — otherwise every render invalidates downstream
  // scale memos.
  const resolvedMargin = useMemo<ChartMargin>(
    () => ({ ...DEFAULT_MARGIN, ...margin }),
    [margin.top, margin.right, margin.bottom, margin.left], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // set the initial size before the first observer callback, so the
    // chart doesn't flash at zero width on mount
    setWidth(element.clientWidth);
    setMeasuredHeight(element.clientHeight || height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setWidth(entry.contentRect.width);
      // Falls back to the resting height when the container reports
      // zero — which happens for a moment while entering fullscreen,
      // and would otherwise collapse every scale to a range of 0.
      setMeasuredHeight(Math.round(entry.contentRect.height) || height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  const dimensions = useMemo<ChartDimensions>(
    () => ({
      width,
      height: measuredHeight,
      margin: resolvedMargin,
      innerWidth: Math.max(0, width - resolvedMargin.left - resolvedMargin.right),
      innerHeight: Math.max(
        0,
        measuredHeight - resolvedMargin.top - resolvedMargin.bottom,
      ),
    }),
    [width, measuredHeight, resolvedMargin],
  );

  return { ref, dimensions } as const;
}
