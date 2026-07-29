// ============================================================
// app/api/prices/pairs/route.ts
//
// GET /api/prices/pairs
// The exact (crop, region) pairs that have price history, with month
// counts and date coverage.
//
// This exposes PriceRepository.findAvailablePairs(), already written for
// the agent — where it stops the model inventing crop/region codes. The
// UI needs the same truth for the mirror-image reason: to disable picker
// combinations that would render an empty chart.
//
// Sits at /api/prices/pairs, which cannot collide with the
// /api/prices/{crop_code}/{region_code} route below it — that one needs
// two segments, this needs one.
// ============================================================

import { NextResponse } from "next/server";

import { pricesService } from "@/lib/container";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const pairs = await pricesService.getAvailablePairs();
    return NextResponse.json({ pairs, total: pairs.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
