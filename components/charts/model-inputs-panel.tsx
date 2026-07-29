"use client";

// ============================================================
// components/charts/model-inputs-panel.tsx
//
// The exact feature row a logged forecast was scored on.
//
// NAMING MATTERS HERE. This shows model INPUTS, not contributions. The
// stored features_used is the vector that went in; we have no SHAP
// values or coefficients, so nothing here attributes the prediction to
// any single feature. Labelling these bars "contribution" would claim
// an explanation the data does not support.
//
// What it does show honestly: the price lags the forecast was built
// from, side by side with the forecast itself — so a prediction far
// outside its own recent history is immediately visible.
// ============================================================

import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { useMemo } from "react";

import { formatDecimal, formatUsdPrecise } from "./format";
import { MARKS, seriesColor } from "./theme";

interface ModelInputsPanelProps {
  features: Record<string, number | string>;
  predictedPrice: number;
}

const LAG_KEYS = [
  { key: "lag_3", label: "3 periods ago" },
  { key: "lag_2", label: "2 periods ago" },
  { key: "lag_1", label: "Previous period" },
  { key: "roll_mean_3", label: "3-period mean" },
];

const MACRO_KEYS = [
  "Crude Oil Price",
  "Fertilizer Price Index",
  "Global Food Price Index",
  "USD Index",
];

const PRICE_COLOR = seriesColor(0);
const FORECAST_COLOR = seriesColor(1);

export function ModelInputsPanel({
  features,
  predictedPrice,
}: ModelInputsPanelProps) {
  const bars = useMemo(() => {
    const rows = LAG_KEYS.map(({ key, label }) => ({
      label,
      value: typeof features[key] === "number" ? (features[key] as number) : null,
      color: PRICE_COLOR,
    })).filter((r): r is { label: string; value: number; color: string } =>
      r.value !== null,
    );

    return [
      ...rows,
      { label: "Forecast", value: predictedPrice, color: FORECAST_COLOR },
    ];
  }, [features, predictedPrice]);

  // Bars encode magnitude by length, so this scale MUST start at zero —
  // a trimmed baseline would exaggerate small differences between lags.
  const scale = useMemo(
    () =>
      scaleLinear()
        .domain([0, max(bars, (b) => b.value) ?? 1])
        .nice()
        .range([0, 100]),
    [bars],
  );

  const macros = MACRO_KEYS.filter((k) => typeof features[k] === "number");

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 text-sm font-medium">
          Recent prices this forecast was built from
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          USD per tonne. These are the model&apos;s inputs, not an attribution
          of the result to each one.
        </p>

        <ul className="space-y-2">
          {bars.map((bar) => (
            <li key={bar.label} className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">
                {bar.label}
              </span>
              <span className="h-5 flex-1 overflow-hidden rounded-[4px] bg-muted/50">
                <span
                  className="block h-full rounded-[4px]"
                  style={{
                    width: `${scale(bar.value)}%`,
                    background: bar.color,
                    minWidth: MARKS.barRadius,
                  }}
                />
              </span>
              {/* Direct value labels, always visible — the relief rule,
                  and cheaper than a hover for five rows */}
              <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">
                {formatUsdPrecise(bar.value)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {macros.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-medium">Macro indicators used</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Four different units, so these are listed rather than plotted
            together.
          </p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {macros.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">{key}</dt>
                <dd className="text-xs font-medium tabular-nums">
                  {formatDecimal(features[key] as number)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
