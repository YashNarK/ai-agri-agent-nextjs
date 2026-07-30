// ============================================================
// app/dashboard/crops/page.tsx
// Crop catalog, grouped by category.
//
// A grouped list rather than a treemap: with this few crops a treemap
// would encode counts as area that the reader can already count, while
// making the names harder to read. The form should earn its complexity.
// ============================================================

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCrops } from "@/lib/api";

export const metadata = { title: "Crops" };
export const dynamic = "force-dynamic";

export default async function CropsPage() {
  const { crops, total } = await getCrops();

  const byCategory = new Map<string, typeof crops>();
  for (const crop of crops) {
    const bucket = byCategory.get(crop.category) ?? [];
    bucket.push(crop);
    byCategory.set(crop.category, bucket);
  }

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Crops</h1>
        <p className="text-sm text-muted-foreground">
          {total} tracked commodities across {byCategory.size} categories.
        </p>
      </header>

      <div className="space-y-6">
        {[...byCategory.entries()].map(([category, items]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="text-base">{category}</CardTitle>
              <CardDescription>
                {items.length} crop{items.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((crop) => (
                <Link
                  key={crop.code}
                  href={`/dashboard/crops/${crop.code}`}
                  className="rounded-lg border p-3 transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{crop.name}</span>
                    <Badge variant="outline">{crop.code}</Badge>
                  </div>
                  {crop.scientific_name && (
                    <p className="mt-1 text-xs text-muted-foreground italic">
                      {crop.scientific_name}
                    </p>
                  )}
                  {crop.avg_yield_per_ha !== null && (
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      ~{crop.avg_yield_per_ha} t/ha
                    </p>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
