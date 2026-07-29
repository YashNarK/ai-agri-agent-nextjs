// ============================================================
// app/api/weather/[region_code]/route.ts
//
// GET /api/weather/{region_code}
// Daily weather observations for a region, oldest first (draw order).
//
// Optional filters: date_from, date_to (YYYY-MM-DD), limit (1–2000).
// Unknown region → 404. A known region with no rows in the window →
// 200 with an empty list, matching the price endpoint.
// ============================================================

import { NextResponse } from "next/server";

import { weatherService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { weatherQuerySchema } from "@/lib/schemas";
import { parseDateOnly } from "@/lib/serialize";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ region_code: string }> },
) {
  try {
    const { region_code } = await params;
    const { searchParams } = new URL(request.url);

    const parsed = weatherQuerySchema.safeParse({
      date_from: searchParams.get("date_from") ?? undefined,
      date_to: searchParams.get("date_to") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { date_from, date_to, limit } = parsed.data;

    return NextResponse.json(
      await weatherService.getWeather({
        regionCode: region_code,
        dateFrom: date_from ? parseDateOnly(date_from) : null,
        dateTo: date_to ? parseDateOnly(date_to) : null,
        limit,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
