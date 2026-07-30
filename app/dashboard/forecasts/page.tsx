// ============================================================
// app/dashboard/forecasts/page.tsx
//
// Forecast audit trail. Every prediction the platform has served is
// persisted with the feature row that produced it, so this browses that
// history — it does NOT call the Azure ML endpoint. Reading is free;
// only POST /api/predictions scores anything.
//
// Selecting a row shows the forecast against the observed history for
// the same crop and region, plus the exact inputs it was scored on.
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
import { getLoggedPredictions, getPriceHistory } from "@/lib/api";
import type { LoggedPrediction } from "@/lib/schemas";

import { ForecastRow } from "./forecast-row";

export const metadata = { title: "Forecasts" };
export const dynamic = "force-dynamic";

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
  searchParams: Promise<{ id?: string }>;
}) {
  // Reading the log is free today, but this page is where user-initiated
  // scoring is going to live, and model output is not public data.
  await requireApproved("/dashboard/forecasts");

  const params = await searchParams;
  const { predictions, total } = await getLoggedPredictions(50);

  const selected =
    predictions.find((p) => String(p.id) === params.id) ?? predictions[0];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Forecasts</h1>
        <p className="text-sm text-muted-foreground">
          Every forecast served, with the inputs that produced it. Browsing
          this is read-only — no model is re-scored.
        </p>
      </header>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No forecasts have been logged yet.
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
            <CardHeader>
              <CardTitle className="text-base">Recent forecasts</CardTitle>
              <CardDescription>
                {total} most recent. Select one to inspect it.
              </CardDescription>
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
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
