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

import { PriceHistoryChart } from "@/components/charts/price-history-chart";
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
  getPriceHistory,
  getRegions,
} from "@/lib/api";

import { PairPicker } from "./pair-picker";

export const metadata = {
  title: "Prices — Agricultural Intelligence",
};

async function PriceSection({
  cropCode,
  regionCode,
}: {
  cropCode: string;
  regionCode: string;
}) {
  const history = await getPriceHistory(cropCode, regionCode, 200);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {history.crop} — {history.region}
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
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
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
