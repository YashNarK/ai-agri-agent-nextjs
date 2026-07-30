// ============================================================
// app/dashboard/prices/page.tsx
//
// Price explorer. A Server Component: crops, regions, available pairs
// and the price series are all fetched on the server, so the browser
// receives data-ready HTML and ships JS only for the picker and the
// chart's interaction layer.
//
// Selection lives in the URL rather than component state, which makes a
// given view linkable and lets the back button work.
// ============================================================

import { Suspense } from "react";

import {
  CorrelationMatrix,
  type CorrelationRow,
} from "@/components/charts/correlation-matrix";
import { pearson } from "@/components/charts/stats";
import { PriceHistoryChart } from "@/components/charts/price-history-chart";
import { SeasonalityHeatmap } from "@/components/charts/seasonality-heatmap";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAvailablePairs,
  getCrops,
  getIndicators,
  getPriceHistory,
  getRegions,
} from "@/lib/api";

import { PairPicker } from "./pair-picker";

export const metadata = {
  title: "Prices â€” Agricultural Intelligence",
};

/**
 * Correlates the price series against each macro indicator.
 *
 * Both are monthly, but they are not guaranteed to cover the same
 * months, so they are joined on the date key rather than zipped by
 * index â€” zipping two differently-covered series silently compares
 * unrelated months and produces a confident, meaningless number.
 */
function correlateWithMacros(
  prices: { price_date: string; price_usd_tonne: number }[],
  series: { indicator_name: string; points: { indicator_date: string; indicator_value: number }[] }[],
): CorrelationRow[] {
  const priceByDate = new Map(
    prices.map((p) => [p.price_date, p.price_usd_tonne]),
  );

  const rows: CorrelationRow[] = [];
  for (const indicator of series) {
    const a: number[] = [];
    const b: number[] = [];
    for (const point of indicator.points) {
      const price = priceByDate.get(point.indicator_date);
      if (price !== undefined) {
        a.push(price);
        b.push(point.indicator_value);
      }
    }
    const coefficient = pearson(a, b);
    if (coefficient !== null) {
      rows.push({
        label: indicator.indicator_name,
        coefficient,
        overlap: a.length,
      });
    }
  }
  return rows;
}

async function PriceSection({
  cropCode,
  regionCode,
}: {
  cropCode: string;
  regionCode: string;
}) {
  const [history, indicators] = await Promise.all([
    getPriceHistory(cropCode, regionCode, 200),
    getIndicators(),
  ]);

  const correlations = correlateWithMacros(history.prices, indicators.series);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {history.crop} â€” {history.region}
          </CardTitle>
          <CardDescription>
            {history.total} monthly observations, USD per tonne
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PriceHistoryChart
            data={history.prices}
            cropName={history.crop}
            regionName={history.region}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seasonality</CardTitle>
          <CardDescription>
            The same prices arranged by month and year. Recurring highs line up
            vertically, which a single continuous line hides.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SeasonalityHeatmap data={history.prices} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Macro indicators</CardTitle>
          <CardDescription>
            How this price moved relative to the four indicators the forecast
            model consumes, over the months both series cover.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CorrelationMatrix rows={correlations} />
        </CardContent>
      </Card>
    </div>
  );
}

export default async function PricesPage({
  searchParams,
}: {
  searchParams: Promise<{ crop?: string; region?: string }>;
}) {
  const params = await searchParams;
  const [pairs, crops, regions] = await Promise.all([
    getAvailablePairs(),
    getCrops(),
    getRegions(),
  ]);

  // default to the first pair that has data, so the page is never empty
  // on first load
  const cropCode = params.crop || pairs[0]?.crop_code || "";
  const regionCode =
    params.region ||
    pairs.find((p) => p.crop_code === cropCode)?.region_code ||
    "";

  const cropNames = Object.fromEntries(crops.crops.map((c) => [c.code, c.name]));
  const regionNames = Object.fromEntries(regions.map((r) => [r.code, r.name]));

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Price explorer</h1>
        <p className="text-sm text-muted-foreground">
          Historical commodity prices and traded volume. Only crop and region
          combinations with recorded history are selectable.
        </p>
      </header>

      <PairPicker
        pairs={pairs}
        cropNames={cropNames}
        regionNames={regionNames}
        cropCode={cropCode}
        regionCode={regionCode}
      />

      {cropCode && regionCode ? (
        <Suspense
          key={`${cropCode}-${regionCode}`}
          fallback={<Skeleton className="h-[460px] w-full rounded-xl" />}
        >
          <PriceSection cropCode={cropCode} regionCode={regionCode} />
        </Suspense>
      ) : (
        <p className="text-sm text-muted-foreground">
          No price history is available yet.
        </p>
      )}
    </div>
  );
}
