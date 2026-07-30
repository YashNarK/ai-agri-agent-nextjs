"use server";

// ============================================================
// app/dashboard/forecasts/actions.ts
//
// Running a forecast from the UI.
//
// This calls the Azure ML endpoint and costs money per invocation, so
// it re-checks approval itself rather than trusting the page that
// rendered the form — a server action is a public endpoint with a
// generated name, reachable by anyone who finds it.
//
// On success it redirects to ?id=<new forecast>, which means the result
// is rendered by exactly the same detail view that browses the audit
// log. One code path for "the forecast you just ran" and "a forecast
// from last week" is the point: they are the same object.
// ============================================================

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireApproved } from "@/lib/auth/guard";
import { loadAppConfig } from "@/lib/aws/app-config";
import { predictionsService } from "@/lib/container";
import { ApiError } from "@/lib/errors";
import { parseDateOnly } from "@/lib/serialize";

import { todayIso } from "./dates";

const FORECASTS_PATH = "/dashboard/forecasts";

export interface PredictionFormState {
  error?: string;
}

export async function runPrediction(
  _previous: PredictionFormState,
  formData: FormData,
): Promise<PredictionFormState> {
  await requireApproved(FORECASTS_PATH);

  const cropCode = String(formData.get("crop_code") ?? "").trim();
  const regionCode = String(formData.get("region_code") ?? "").trim();
  const targetDate = String(formData.get("target_date") ?? "").trim();

  if (!cropCode || !regionCode || !targetDate) {
    return { error: "Choose a crop, a region and a target date." };
  }

  // Re-validated here, not just with the input's `min` attribute: that
  // is a hint to the browser, not a constraint on the request. The model
  // is trained to extrapolate forward from lagged prices, so a past
  // target would be answered confidently and meaninglessly.
  if (targetDate <= todayIso()) {
    return { error: "The target date must be in the future." };
  }

  let id: number;
  try {
    const config = await loadAppConfig();
    const prediction = await predictionsService.predictPrice({
      cropCode,
      regionCode,
      targetDate: parseDateOnly(targetDate),
      config,
    });
    id = prediction.id;
  } catch (error) {
    // 422 means the pair has no price history to build features from,
    // which is a normal thing to ask for and get told no — surface the
    // service's own wording rather than a generic failure.
    if (error instanceof ApiError) {
      return { error: error.detail };
    }
    console.error("[forecast] prediction failed", error);
    return { error: "The prediction service could not be reached." };
  }

  revalidatePath(FORECASTS_PATH);
  redirect(`${FORECASTS_PATH}?id=${id}`);
}
