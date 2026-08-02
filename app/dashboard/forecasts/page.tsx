// ============================================================
// app/dashboard/forecasts/page.tsx
//
// Ask the model for a price, then inspect the answer.
//
// The form leads, because running a forecast is what this page is for.
// The audit trail below is the second-order benefit: every run is
// persisted with the exact feature row that produced it, so a forecast
// stays explainable long after it was made.
//
// A new run and an old one render through the same detail view — they
// are the same object, and giving "the one you just ran" a special-case
// display would be two code paths for one thing.
// ============================================================

import { Suspense } from "react";

import { ForecastChart } from "@/components/charts/forecast-chart";
import { ModelInputsPanel } from "@/components/charts/model-inputs-panel";
import { formatUsdPrecise } from "@/components/charts/format";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireApproved } from "@/lib/auth/guard";
import {
  getCrops,
  getLoggedPredictions,
  getPrediction,
  getPriceHistory,
  getRegions,
} from "@/lib/api";
import { TablePagination, TableSearch } from "@/components/ui/table-toolbar";
import type { LoggedPrediction } from "@/lib/schemas";

import { isoDaysFromToday } from "./dates";
import { ForecastRow } from "./forecast-row";
import { PredictionForm } from "./prediction-form";

export const metadata = { title: "Forecasts" };
export const dynamic = "force-dynamic";

// runForecast in ./actions.ts scores against the model Lambda, whose
// cold start is ~9.4s. Server Actions take their duration budget from
// the route segment they are invoked under, so without this the first
// forecast of an idle period can exceed Vercel's 10s Hobby default and
// fail from the UI while the same call succeeds via /api/predictions.
export const maxDuration = 60;

/**
 * Rows per page. Small enough that the table never needs its own scroll
 * region, which keeps the pager visible without the page jumping.
 */
const PAGE_SIZE = 20;

async function ForecastDetail({ forecast }: { forecast: LoggedPrediction }) {
  // last ~3 years of context, enough to read the trend the forecast
  // extends without compressing it into a wall of points
  const history = await getPriceHistory(
    forecast.crop_code,
    forecast.region_code,
    36,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {forecast.crop_name} — {forecast.region_name}
          </CardTitle>
          <CardDescription>
            Forecast for {forecast.target_date}, scored{" "}
            {new Date(forecast.prediction_date).toLocaleDateString("en-US", {
              dateStyle: "medium",
            })}
            {forecast.model_version ? ` by ${forecast.model_version}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForecastChart
            history={history.prices}
            forecast={forecast}
            cropName={forecast.crop_name}
            regionName={forecast.region_name}
          />
        </CardContent>
      </Card>

      {forecast.features_used && (
        <Card>
          <CardHeader>
            <CardTitle>What the model was given</CardTitle>
            <CardDescription>
              The exact feature row scored, persisted alongside the result.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ModelInputsPanel
              features={forecast.features_used}
              predictedPrice={forecast.predicted_price}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default async function ForecastsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; q?: string; page?: string }>;
}) {
  // Running a forecast calls Azure ML, and model output is not public.
  await requireApproved("/dashboard/forecasts");

  const params = await searchParams;
  const query = params.q?.trim() || null;
  const page = Math.max(1, Number(params.page) || 1);

  const [{ predictions, total }, newest, cropList, regions] = await Promise.all([
    getLoggedPredictions(PAGE_SIZE, page, query),
    // Unfiltered, so the default selection does not move with the search.
    getLoggedPredictions(1, 1, null),
    getCrops(),
    getRegions(),
  ]);

  // Fetched by id rather than looked up in the rows above: the selected
  // forecast need not be on the page being shown — a search filter or
  // any page past the first hides it, and a fresh run redirects here
  // with an id before the table has been paged at all.
  //
  // The fallback is the newest forecast OVERALL, deliberately not the
  // first row of the current page. The detail panel sits above the
  // table, so making it follow the filter meant it swapped content — and
  // height — on every keystroke, shifting the search box out from under
  // the cursor. Selection now changes only when you pick a row.
  const selected =
    (params.id ? await getPrediction(Number(params.id)) : null) ??
    newest.predictions[0];

  // Bounds computed on the server so the earliest selectable date does
  // not depend on the viewer's clock or timezone, and matches what the
  // action will accept. A month out is a useful default: close enough
  // that recent prices still carry signal, far enough to be a forecast.
  const tomorrow = isoDaysFromToday(1);
  const defaultTarget = isoDaysFromToday(30);

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Forecasts</h1>
        <p className="text-sm text-muted-foreground">
          Score the price model for a crop and region on a future date. Every
          run is logged with the feature row behind it.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run a forecast</CardTitle>
          <CardDescription>
            The model extrapolates from recorded price history, so a pair with
            no history cannot be scored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PredictionForm
            crops={cropList.crops}
            regions={regions}
            minDate={tomorrow}
            defaultDate={defaultTarget}
          />
        </CardContent>
      </Card>

      {total === 0 && !query ? (
        <p className="text-sm text-muted-foreground">
          No forecasts have been run yet. Use the form above to make the first
          one.
        </p>
      ) : (
        <>
          {selected && (
            <Suspense
              key={selected.id}
              fallback={<Skeleton className="h-[420px] w-full rounded-xl" />}
            >
              <ForecastDetail forecast={selected} />
            </Suspense>
          )}

          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle className="text-base">Forecast log</CardTitle>
                <CardDescription>
                  Every run, newest first. Select one to inspect it.
                </CardDescription>
              </div>
              {/*
                NOT wrapped in Suspense. useSearchParams only needs a
                boundary on a PRERENDERED route, and this one is
                force-dynamic. With a boundary here, every search-param
                change could swap in the fallback — unmounting the input
                mid-type, throwing focus to <body> and collapsing the
                header, which reads as the page jumping to the top.
              */}
              <TableSearch placeholder="Search crop or region…" />
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Crop</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead className="text-right">Predicted</TableHead>
                      <TableHead className="text-right">Interval</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {predictions.map((p) => (
                      <ForecastRow
                        key={p.id}
                        id={p.id}
                        selected={selected?.id === p.id}
                      >
                        <TableCell className="font-medium">
                          {p.crop_code}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.region_code}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {p.target_date}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatUsdPrecise(p.predicted_price)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {p.confidence_low !== null &&
                          p.confidence_high !== null ? (
                            `${formatUsdPrecise(p.confidence_low)} – ${formatUsdPrecise(p.confidence_high)}`
                          ) : (
                            <Badge variant="outline">none</Badge>
                          )}
                        </TableCell>
                      </ForecastRow>
                    ))}
                  </TableBody>
                </Table>

                {predictions.length === 0 && (
                  <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                    No forecasts match {query ? `“${query}”` : "this filter"}.
                  </p>
                )}
              </div>

              <TablePagination page={page} pageSize={PAGE_SIZE} total={total} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
