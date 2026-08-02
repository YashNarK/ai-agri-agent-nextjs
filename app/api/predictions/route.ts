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

import { requireApprovedApi } from "@/lib/auth/guard";
import { loadAppConfig } from "@/lib/aws/app-config";
import { predictionsService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import {
  predictionListQuerySchema,
  predictionRequestSchema,
} from "@/lib/schemas";
import { parseDateOnly } from "@/lib/serialize";

export const runtime = "nodejs";

// The model Lambda cold-starts in ~9.4s (unpacking a 536 MB container
// image). Add the Neon round-trips POST makes either side of it — three
// lag prices, four macro indicators, then the insert — and a cold
// forecast can land near 11s. Vercel's default function duration is 10s
// on Hobby, so leaving this unset means the first forecast after an idle
// period intermittently 504s while a warm one returns in ~200ms.
// 60 is well clear and still far below the 300 used by the chat routes.
export const maxDuration = 60;

/**
 * GET /api/predictions — browse forecasts already logged.
 *
 * Read-only and free: POST is what calls the price model and
 * writes the row; this just reads what that produced, including the
 * feature vector each forecast was scored on.
 *
 * Optional filters: crop_code, region_code, limit (1–500).
 */
export async function GET(request: Request) {
  try {
    // Guarded despite being free to serve: a forecast log is this
    // platform's model output, and listing it reveals what has been
    // predicted for whom. The cost asymmetry with POST is real, but it
    // is not a reason to make the history public.
    await requireApprovedApi();

    const { searchParams } = new URL(request.url);

    const parsed = predictionListQuerySchema.safeParse({
      crop_code: searchParams.get("crop_code") ?? undefined,
      region_code: searchParams.get("region_code") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      q: searchParams.get("q") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { crop_code, region_code, limit, page, q } = parsed.data;

    return NextResponse.json(
      await predictionsService.listPredictions({
        cropCode: crop_code,
        regionCode: region_code,
        limit,
        page,
        search: q,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // This is the expensive one — every call scores against the Azure ML
    // managed endpoint.
    await requireApprovedApi();

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
