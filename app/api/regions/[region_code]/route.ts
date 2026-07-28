// ============================================================
// app/api/regions/[region_code]/route.ts
// GET /api/regions/{region_code} — a single region by its unique,
// case-sensitive code (e.g. US-CORN, BR-SOY, IN-RICE). 404 if unknown.
//
// Port of routers/regions.py
// ============================================================

import { NextResponse } from "next/server";

import { regionsService } from "@/lib/container";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ region_code: string }> },
) {
  try {
    const { region_code } = await params;
    return NextResponse.json(await regionsService.getRegionByCode(region_code));
  } catch (error) {
    return toErrorResponse(error);
  }
}
