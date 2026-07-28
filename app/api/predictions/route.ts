// ============================================================
// app/api/predictions/route.ts
//
// POST /api/predictions — ML price forecast (USD/tonne) for a crop
// in a region on a future target_date, with a confidence interval.
//
// How it works
//   1. recent price history for the (crop, region) pair is read from
//      Postgres and turned into model features (lagged prices, rolling
//      mean, seasonal month encoding, latest macro indicators)
//   2. the feature row is sent to the Azure ML managed online endpoint
//      hosting the Gradient Boosting model
//   3. the predicted price plus confidence bounds are returned AND
//      logged to price_predictions for audit
//
// Errors: 404 unknown code · 422 no price history · 502 endpoint down
//
// Port of routers/predictions.py
// ============================================================

import { NextResponse } from "next/server";

import { loadAppConfig } from "@/lib/aws/app-config";
import { predictionsService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { predictionRequestSchema } from "@/lib/schemas";
import { parseDateOnly } from "@/lib/serialize";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = predictionRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { crop_code, region_code, target_date } = parsed.data;
    const config = await loadAppConfig();

    const prediction = await predictionsService.predictPrice({
      cropCode: crop_code,
      regionCode: region_code,
      targetDate: parseDateOnly(target_date),
      config,
    });

    return NextResponse.json(prediction, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
