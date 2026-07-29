// ============================================================
// app/api/yields/[crop_code]/route.ts
//
// GET /api/yields/{crop_code}
// Harvest yield history for a crop, ascending by year.
//
// Optional filters: region_code, year_from, year_to. Region is left as a
// query param rather than a second path segment because the common case
// is "this crop across all regions" — the shape the scatter plot wants.
//
// Unknown crop or region code → 404.
// ============================================================

import { NextResponse } from "next/server";

import { yieldsService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { yieldQuerySchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ crop_code: string }> },
) {
  try {
    const { crop_code } = await params;
    const { searchParams } = new URL(request.url);

    const parsed = yieldQuerySchema.safeParse({
      region_code: searchParams.get("region_code") ?? undefined,
      year_from: searchParams.get("year_from") ?? undefined,
      year_to: searchParams.get("year_to") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { region_code, year_from, year_to } = parsed.data;

    return NextResponse.json(
      await yieldsService.getYields({
        cropCode: crop_code,
        regionCode: region_code,
        yearFrom: year_from,
        yearTo: year_to,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
