"use client";

// ============================================================
// components/chat/artifact-cards.tsx
//
// Renders a tool's structured artifact inside the chat transcript.
//
// FORM IS CHOSEN PER ARTIFACT, NOT PER TOOL. A price history is a real
// monthly series, so it gets the same d3 chart the dashboard uses. A
// forecast is ONE number with an interval — a line chart through a
// single point would be a chart drawn for the sake of drawing one, so
// it gets a hero number and a range bar instead. Weather here is three
// rows and indicators are one value each: those are tables, because a
// three-point "trend" invites a reader to see a slope that three
// samples cannot support.
// ============================================================

import {
  PriceHistoryChart,
  type PricePoint,
} from "@/components/charts/price-history-chart";
import { SimilarityBar } from "@/components/charts/similarity-bar";
import { formatDecimal, formatUsdPrecise } from "@/components/charts/format";
import { MARKS, seriesColor } from "@/components/charts/theme";
import { Badge } from "@/components/ui/badge";
import type {
  AvailabilityArtifact,
  ForecastArtifact,
  IndicatorsArtifact,
  KnowledgeArtifact,
  PriceHistoryArtifact,
  ToolArtifact,
  WeatherArtifact,
} from "@/agents/artifacts";

const FORECAST_COLOR = seriesColor(1);

function Frame({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">{title}</p>
      {caption && (
        <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------
// A single forecast: hero number + the interval around it.
// ------------------------------------------------------------
function ForecastCard({ artifact }: { artifact: ForecastArtifact }) {
  const { predicted_price, confidence_low, confidence_high } = artifact;
  const hasInterval = confidence_low !== null && confidence_high !== null;

  // the bar spans the interval; the marker sits where the point estimate
  // falls within it, which is not necessarily the middle
  const span = hasInterval ? confidence_high - confidence_low : 0;
  const markerPct =
    hasInterval && span > 0
      ? ((predicted_price - confidence_low) / span) * 100
      : 50;

  return (
    <Frame
      title={`${artifact.crop} — ${artifact.region}`}
      caption={`Model forecast for ${artifact.target_date}`}
    >
      <p className="text-3xl font-semibold tabular-nums">
        {formatUsdPrecise(predicted_price)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          per tonne
        </span>
      </p>

      {hasInterval ? (
        <div className="mt-4 space-y-1.5">
          <div className="relative h-2 rounded-full bg-muted">
            <div
              className="absolute inset-y-0 rounded-full"
              style={{
                left: 0,
                right: 0,
                background: FORECAST_COLOR,
                opacity: MARKS.bandOpacity * 3,
              }}
            />
            <div
              className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${markerPct}%`, background: FORECAST_COLOR }}
            />
          </div>
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{formatUsdPrecise(confidence_low)}</span>
            <span>confidence interval</span>
            <span>{formatUsdPrecise(confidence_high)}</span>
          </div>
        </div>
      ) : (
        // deliberately NOT a zero-width band — that would render as
        // perfect certainty when the truth is that none was reported
        <p className="mt-3 text-xs text-muted-foreground">
          The model returned no confidence interval for this forecast.
        </p>
      )}
    </Frame>
  );
}

// ------------------------------------------------------------
function PriceHistoryCard({ artifact }: { artifact: PriceHistoryArtifact }) {
  const points: PricePoint[] = artifact.points;
  const rising = artifact.change_pct >= 0;

  return (
    <Frame
      title={`${artifact.crop} — ${artifact.region}`}
      caption={`${points.length} monthly observations · latest ${formatUsdPrecise(
        artifact.latest,
      )}/t · ${rising ? "+" : ""}${artifact.change_pct.toFixed(1)}% over the window`}
    >
      <PriceHistoryChart
        data={points}
        cropName={artifact.crop}
        regionName={artifact.region}
        height={240}
      />
    </Frame>
  );
}

// ------------------------------------------------------------
function KnowledgeCard({ artifact }: { artifact: KnowledgeArtifact }) {
  return (
    <Frame
      title="Knowledge base matches"
      caption={`Semantic search for “${artifact.query}”`}
    >
      <ul className="space-y-3">
        {artifact.results.map((result, index) => (
          <li key={`${result.title}-${index}`} className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium">{result.title}</span>
              {result.category && (
                <Badge variant="secondary" className="shrink-0">
                  {result.category}
                </Badge>
              )}
            </div>
            <SimilarityBar value={result.similarity} />
          </li>
        ))}
      </ul>
    </Frame>
  );
}

// ------------------------------------------------------------
/**
 * How many pairs to list before folding the rest into a count.
 *
 * This tool returns every pair with history — 187 of them against the
 * current database. Rendering all of them turns one chat bubble into a
 * page of scrolling and buries the answer that follows it. The ones
 * shown are the longest series, and the remainder is stated rather than
 * silently dropped.
 */
const PAIRS_SHOWN = 12;

function AvailabilityCard({ artifact }: { artifact: AvailabilityArtifact }) {
  const ranked = [...artifact.pairs].sort((a, b) => b.months - a.months);
  const shown = ranked.slice(0, PAIRS_SHOWN);
  const hidden = ranked.length - shown.length;

  return (
    <Frame
      title="Data availability"
      caption={
        `${artifact.pairs.length} crop × region pairs have price history. ` +
        "Only these can be charted or forecast."
      }
    >
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {shown.map((pair) => (
          <li
            key={`${pair.crop_code}-${pair.region_code}`}
            className="flex items-baseline justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5"
          >
            <span className="font-mono text-xs">
              {pair.crop_code} @ {pair.region_code}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {pair.months} mo
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {hidden > 0 && (
          <>
            Showing the {PAIRS_SHOWN} longest series; {hidden} further pairs
            also have history.{" "}
          </>
        )}
        {artifact.crops.length} crops and {artifact.regions.length} regions are
        defined in total; the rest have no recorded prices.
      </p>
    </Frame>
  );
}

// ------------------------------------------------------------
function WeatherCard({ artifact }: { artifact: WeatherArtifact }) {
  return (
    <Frame
      title={`Recent weather — ${artifact.region}`}
      caption={`${artifact.records.length} most recent observations`}
    >
      <table className="w-full text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="pb-1.5 font-normal">Date</th>
            <th className="pb-1.5 text-right font-normal">Avg °C</th>
            <th className="pb-1.5 text-right font-normal">Rain mm</th>
            <th className="pb-1.5 text-right font-normal">Drought</th>
          </tr>
        </thead>
        <tbody>
          {artifact.records.map((record) => (
            <tr key={record.weather_date} className="border-t">
              <td className="py-1.5">{record.weather_date}</td>
              <td className="py-1.5 text-right">
                {record.temp_avg_c === null ? "—" : formatDecimal(record.temp_avg_c)}
              </td>
              <td className="py-1.5 text-right">
                {record.rainfall_mm === null
                  ? "—"
                  : formatDecimal(record.rainfall_mm)}
              </td>
              <td className="py-1.5 text-right">
                {record.drought_index === null
                  ? "—"
                  : formatDecimal(record.drought_index)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

// ------------------------------------------------------------
function IndicatorsCard({ artifact }: { artifact: IndicatorsArtifact }) {
  return (
    <Frame
      title="Macro indicators"
      caption="Latest recorded value for each indicator"
    >
      <ul className="space-y-1.5">
        {artifact.indicators.map((indicator) => (
          <li
            key={indicator.indicator_name}
            className="flex items-baseline justify-between gap-3 text-xs"
          >
            <span className="text-muted-foreground">
              {indicator.indicator_name}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatDecimal(indicator.indicator_value)}
              {indicator.unit ? ` ${indicator.unit}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

/** Dispatches on the artifact tag. */
export function ArtifactCard({ artifact }: { artifact: ToolArtifact }) {
  switch (artifact.kind) {
    case "forecast":
      return <ForecastCard artifact={artifact} />;
    case "price_history":
      return <PriceHistoryCard artifact={artifact} />;
    case "knowledge":
      return <KnowledgeCard artifact={artifact} />;
    case "availability":
      return <AvailabilityCard artifact={artifact} />;
    case "weather":
      return <WeatherCard artifact={artifact} />;
    case "indicators":
      return <IndicatorsCard artifact={artifact} />;
  }
}
