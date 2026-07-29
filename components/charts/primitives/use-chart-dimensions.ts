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

export function useChartDimensions<T extends HTMLElement = HTMLDivElement>(
  height = 260,
  margin: Partial<ChartMargin> = {},
) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

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

    // set the initial width before the first observer callback, so the
    // chart doesn't flash at zero width on mount
    setWidth(element.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dimensions = useMemo<ChartDimensions>(
    () => ({
      width,
      height,
      margin: resolvedMargin,
      innerWidth: Math.max(0, width - resolvedMargin.left - resolvedMargin.right),
      innerHeight: Math.max(0, height - resolvedMargin.top - resolvedMargin.bottom),
    }),
    [width, height, resolvedMargin],
  );

  return { ref, dimensions } as const;
}
