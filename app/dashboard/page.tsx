// ============================================================
// app/dashboard/page.tsx
//
// Overview: coverage stat tiles, then the macro indicators as small
// multiples.
//
// The tiles are deliberately NOT charts. Four single numbers have no
// shape to compare, and plotting them would add ink without adding
// information — a hero figure with a label is the right form for a lone
// magnitude.
// ============================================================

import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { formatCompact, formatDecimal } from "@/components/charts/format";
import { seriesColor } from "@/components/charts/theme";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAvailablePairs, getCrops, getIndicators, getRegions } from "@/lib/api";

export const metadata = { title: "Overview" };

// Without this the page has no dynamic API, so Next prerenders it at
// build time — baking a snapshot of the database into the bundle. These
// counts and indicator series must reflect the live database on every
// request, so opt out of static generation explicitly.
export const dynamic = "force-dynamic";

function StatTile({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="mt-1 text-sm font-medium">{label}</p>
        {hint && (
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const [crops, regions, pairs, indicators] = await Promise.all([
    getCrops(),
    getRegions(),
    getAvailablePairs(),
    getIndicators(),
  ]);

  const totalMonths = pairs.reduce((sum, p) => sum + p.months, 0);
  const coverage = pairs.length
    ? `${pairs[0].start_date.slice(0, 4)}–${pairs[0].end_date.slice(0, 4)}`
    : "—";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          What the platform currently tracks.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile value={String(crops.total)} label="Crops" hint="Tracked commodities" />
        <StatTile value={String(regions.length)} label="Regions" hint="Growing regions" />
        <StatTile
          value={String(pairs.length)}
          label="Price series"
          hint={`Crop × region pairs, ${coverage}`}
        />
        <StatTile
          value={formatCompact(totalMonths)}
          label="Monthly observations"
          hint="Across all series"
        />
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Macro indicators
          </h2>
          <p className="text-sm text-muted-foreground">
            The four drivers the price model consumes as features. Each is its
            own panel — they are different units and do not share a scale.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {indicators.series.map((series, index) => {
            const values = series.points.map((p) => p.indicator_value);
            const latest = values.at(-1);
            const first = values[0];
            const change =
              first && latest ? ((latest - first) / first) * 100 : null;

            return (
              <Card key={series.indicator_name}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {series.indicator_name}
                  </CardTitle>
                  <CardDescription>
                    {series.points.length} observations
                    {series.unit ? ` · ${series.unit}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">
                      {latest === undefined ? "—" : formatDecimal(latest)}
                    </p>
                    {change !== null && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {change >= 0 ? "+" : ""}
                        {change.toFixed(1)}% over the record
                      </p>
                    )}
                  </div>
                  <Sparkline
                    values={values}
                    color={seriesColor(index)}
                    label={`${series.indicator_name} over time`}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Explore prices</CardTitle>
            <CardDescription>
              Price history and seasonality for any crop and region with
              recorded data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard/prices"
              className="text-sm font-medium underline underline-offset-4"
            >
              Open the price explorer
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Browse regions</CardTitle>
            <CardDescription>
              Weather records and the crops grown in each region.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard/regions"
              className="text-sm font-medium underline underline-offset-4"
            >
              Open regions
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
