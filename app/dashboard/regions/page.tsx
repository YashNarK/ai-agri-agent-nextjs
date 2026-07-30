// ============================================================
// app/dashboard/regions/page.tsx
// Region index — every region as a card linking to its detail page.
// ============================================================

import Link from "next/link";

import { RegionMap } from "@/components/charts/region-map";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRegions } from "@/lib/api";

export const metadata = { title: "Regions" };

// Read from the live database on each request rather than being
// prerendered into the bundle at build time.
export const dynamic = "force-dynamic";

export default async function RegionsPage() {
  const regions = await getRegions();

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Regions</h1>
        <p className="text-sm text-muted-foreground">
          {regions.length} growing regions. Open one for its weather record and
          yield history.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where they are</CardTitle>
          <CardDescription>
            Plotted from stored coordinates on an orthographic globe, so
            shapes and areas are undistorted. Drag to rotate. Country
            outlines are there for orientation only — the database holds
            points, not country-level measures, so nothing is shaded by
            value.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RegionMap regions={regions} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((region) => (
          <Link
            key={region.code}
            href={`/dashboard/regions/${region.code}`}
            className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:border-foreground/20">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{region.name}</CardTitle>
                  {region.climate && (
                    <Badge variant="secondary">{region.climate}</Badge>
                  )}
                </div>
                <CardDescription>
                  {region.country} · {region.code}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
