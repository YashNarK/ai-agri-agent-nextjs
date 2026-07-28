// ============================================================
// app/api/regions/route.ts
// GET /api/regions — all geographic regions, ordered by name
//
// Each region includes its unique `code`, used as a path parameter
// across the API (e.g. /api/prices/{crop_code}/{region_code}).
//
// Port of routers/regions.py
// ============================================================

import { NextResponse } from "next/server";

import { regionsService } from "@/lib/container";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await regionsService.listRegions());
  } catch (error) {
    return toErrorResponse(error);
  }
}
