// ============================================================
// app/dashboard/regions/[region_code]/page.tsx
//
// One region: its weather record and the crops grown there.
//
// The weather panel streams behind Suspense because it pulls the most
// rows on the page — the region header renders immediately rather than
// the whole route waiting on it.
// ============================================================

import { notFound } from "next/navigation";
import { Suspense } from "react";

import { WeatherPanel } from "@/components/charts/weather-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/errors";
import { getAvailablePairs, getRegion, getWeather } from "@/lib/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ region_code: string }>;
}) {
  const { region_code } = await params;
  return { title: region_code };
}

async function WeatherSection({ regionCode }: { regionCode: string }) {
  const weather = await getWeather(regionCode, 400);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weather record</CardTitle>
        <CardDescription>
          {weather.total} observations. Temperature, rainfall and drought index
          are three different units, so they are three panels sharing one time
          axis rather than one chart with stacked scales.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <WeatherPanel
          data={weather.observations}
          regionName={weather.region}
        />
      </CardContent>
    </Card>
  );
}

export default async function RegionPage({
  params,
}: {
  params: Promise<{ region_code: string }>;
}) {
  const { region_code } = await params;

  // the service throws a 404 ApiError for an unknown code; translate it
  // into Next's not-found page rather than a 500
  let region;
  try {
    region = await getRegion(region_code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const pairs = await getAvailablePairs();
  const cropsHere = pairs.filter((p) => p.region_code === region.code);

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {region.name}
          </h1>
          {region.climate && <Badge variant="secondary">{region.climate}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {region.country} · {region.code}
          {region.latitude !== null && region.longitude !== null && (
            <>
              {" "}
              · {region.latitude.toFixed(3)}, {region.longitude.toFixed(3)}
            </>
          )}
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-xl" />}>
        <WeatherSection regionCode={region.code} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>Crops with price history here</CardTitle>
          <CardDescription>
            {cropsHere.length} tracked crop
            {cropsHere.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {cropsHere.length > 0 ? (
            cropsHere.map((pair) => (
              <Badge key={pair.crop_code} variant="outline">
                {pair.crop_code} · {pair.months} mo
              </Badge>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No price history recorded for this region.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
