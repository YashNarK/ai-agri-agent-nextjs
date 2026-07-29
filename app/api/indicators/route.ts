// ============================================================
// app/api/indicators/route.ts
//
// GET /api/indicators
// Macro market indicators grouped into plottable series.
//
// Optional filters: names (comma-separated), date_from, date_to, limit.
// Omitting `names` returns every indicator — the four the price model
// consumes are listed in services/price-features.ts.
//
// Returns { series: [{ indicator_name, unit, points: [...] }] } rather
// than flat rows, since each series is drawn as one path.
// ============================================================

import { NextResponse } from "next/server";

import { indicatorsService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { indicatorQuerySchema } from "@/lib/schemas";
import { parseDateOnly } from "@/lib/serialize";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const parsed = indicatorQuerySchema.safeParse({
      names: searchParams.get("names") ?? undefined,
      date_from: searchParams.get("date_from") ?? undefined,
      date_to: searchParams.get("date_to") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { names, date_from, date_to, limit } = parsed.data;

    return NextResponse.json(
      await indicatorsService.getSeries({
        names: names
          ? names.split(",").map((n) => n.trim()).filter(Boolean)
          : null,
        dateFrom: date_from ? parseDateOnly(date_from) : null,
        dateTo: date_to ? parseDateOnly(date_to) : null,
        limit,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
