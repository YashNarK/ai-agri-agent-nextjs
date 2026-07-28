// ============================================================
// app/api/prices/[crop_code]/[region_code]/route.ts
//
// GET /api/prices/{crop_code}/{region_code}
// Historical commodity prices (USD per tonne), most recent first.
//
// Optional filters: date_from / date_to (YYYY-MM-DD), limit (1–500).
//
// Behaviour:
//   - unknown crop_code or region_code → 404
//   - a valid pair with no rows in the window → 200 with an empty
//     `prices` list (total: 0), NOT a 404
//
// Port of routers/prices.py
// ============================================================

import { NextResponse } from "next/server";

import { pricesService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { priceHistoryQuerySchema } from "@/lib/schemas";
import { parseDateOnly } from "@/lib/serialize";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ crop_code: string; region_code: string }> },
) {
  try {
    const { crop_code, region_code } = await params;
    const { searchParams } = new URL(request.url);

    const parsed = priceHistoryQuerySchema.safeParse({
      date_from: searchParams.get("date_from") ?? undefined,
      date_to: searchParams.get("date_to") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { date_from, date_to, limit } = parsed.data;

    return NextResponse.json(
      await pricesService.getPriceHistory({
        cropCode: crop_code,
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
