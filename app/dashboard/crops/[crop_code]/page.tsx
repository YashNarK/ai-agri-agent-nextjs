// ============================================================
// app/dashboard/crops/[crop_code]/page.tsx
// One crop: its yield record across regions, and where it has prices.
// ============================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { YieldScatter } from "@/components/charts/yield-scatter";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAvailablePairs, getCrop, getYields } from "@/lib/api";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ crop_code: string }>;
}) {
  const { crop_code } = await params;
  return { title: crop_code };
}

async function YieldSection({
  cropCode,
  cropName,
}: {
  cropCode: string;
  cropName: string;
}) {
  const yields = await getYields(cropCode);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yield and harvested area</CardTitle>
        <CardDescription>
          {yields.total} harvest records. Each dot is one region-year; dot area
          is total production. Only the three regions with the most records get
          their own colour — beyond that the palette can no longer keep every
          pair distinguishable in a scatter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <YieldScatter data={yields.yields} cropName={cropName} />
      </CardContent>
    </Card>
  );
}

export default async function CropPage({
  params,
}: {
  params: Promise<{ crop_code: string }>;
}) {
  const { crop_code } = await params;

  let crop;
  try {
    crop = await getCrop(crop_code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const pairs = await getAvailablePairs();
  const regionsWithPrices = pairs.filter((p) => p.crop_code === crop.code);

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-6 px-6 py-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{crop.name}</h1>
          <Badge variant="outline">{crop.code}</Badge>
          <Badge variant="secondary">{crop.category}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {crop.scientific_name && <em>{crop.scientific_name}</em>}
          {crop.scientific_name && crop.growing_season && " · "}
          {crop.growing_season && `Season ${crop.growing_season}`}
          {crop.avg_yield_per_ha !== null &&
            ` · typical ${crop.avg_yield_per_ha} t/ha`}
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-[440px] w-full rounded-xl" />}>
        <YieldSection cropCode={crop.code} cropName={crop.name} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regions with price history</CardTitle>
          <CardDescription>
            {regionsWithPrices.length} region
            {regionsWithPrices.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {regionsWithPrices.length > 0 ? (
            regionsWithPrices.map((pair) => (
              <Link
                key={pair.region_code}
                href={`/dashboard/prices?crop=${crop.code}&region=${pair.region_code}`}
              >
                <Badge
                  variant="outline"
                  className="cursor-pointer hover:border-foreground/40"
                >
                  {pair.region_code} · {pair.months} mo
                </Badge>
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No price history recorded for this crop.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
