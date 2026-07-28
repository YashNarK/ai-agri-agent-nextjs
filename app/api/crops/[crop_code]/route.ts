// ============================================================
// app/api/crops/[crop_code]/route.ts
// GET /api/crops/{crop_code} — a single crop by its unique,
// case-sensitive code (e.g. MAIZE, WHEAT-W, SOY). 404 if unknown.
//
// Port of routers/crops.py
// ============================================================

import { NextResponse } from "next/server";

import { cropsService } from "@/lib/container";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ crop_code: string }> },
) {
  try {
    const { crop_code } = await params;
    return NextResponse.json(await cropsService.getCropByCode(crop_code));
  } catch (error) {
    return toErrorResponse(error);
  }
}
