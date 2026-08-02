// ============================================================
// scripts/e2e-forecast.ts
//
// Full-stack forecast test: drives the real PredictionsService from
// lib/container against the real database and the real model Lambda.
//
//   Postgres (crop, region, lags, macros) -> Lambda (SigV4) -> Postgres insert
//
// This is the same code path POST /api/predictions and the dashboard's
// runForecast server action take; it skips only the HTTP layer and the
// session guard, which the model cutover did not touch.
//
// It WRITES a row to price_predictions — that is what a forecast does,
// and the row is the audit trail. It reads the id back to prove the
// insert landed.
//
//   npx tsx scripts/e2e-forecast.ts
// ============================================================

import "dotenv/config";

import { loadAppConfig } from "@/lib/aws/app-config";
import { predictionsService } from "@/lib/container";
import { parseDateOnly } from "@/lib/serialize";

const CROP = "MAIZE";
const REGION = "US-CORN";
const TARGET = "2026-12-01";

async function main() {
  console.log(`forecast : ${CROP} @ ${REGION} on ${TARGET}\n`);

  const configStarted = Date.now();
  const config = await loadAppConfig();
  console.log(`config loaded in ${Date.now() - configStarted} ms`);
  console.log(`  region   : ${process.env.APP_AWS_REGION ?? "ap-south-1"}`);
  console.log(`  function : ${config.model.functionName}`);
  console.log(`  version  : ${config.model.modelName}\n`);

  const started = Date.now();
  const saved = await predictionsService.predictPrice({
    cropCode: CROP,
    regionCode: REGION,
    targetDate: parseDateOnly(TARGET),
    config,
  });
  const elapsed = Date.now() - started;

  console.log(`predictPrice returned in ${elapsed} ms\n`);
  console.log(`  id              : ${saved.id}`);
  console.log(`  predicted_price : ${saved.predicted_price}`);
  console.log(`  confidence_low  : ${saved.confidence_low}`);
  console.log(`  confidence_high : ${saved.confidence_high}`);
  console.log(`  model_version   : ${saved.model_version}`);
  console.log(`  prediction_date : ${saved.prediction_date}\n`);

  // Read it back — proves the insert committed, not just that the
  // service returned an object.
  const reread = await predictionsService.getPrediction(saved.id);
  const checks: [string, boolean, string][] = [
    ["row persisted and re-readable", reread !== null, `id ${saved.id}`],
    [
      "price is a real number",
      Number.isFinite(saved.predicted_price) && saved.predicted_price > 0,
      String(saved.predicted_price),
    ],
    [
      "confidence band brackets the point estimate",
      saved.confidence_low !== null &&
        saved.confidence_high !== null &&
        saved.confidence_low <= saved.predicted_price &&
        saved.predicted_price <= saved.confidence_high,
      `${saved.confidence_low} <= ${saved.predicted_price} <= ${saved.confidence_high}`,
    ],
    [
      "features_used logged for audit",
      reread?.features_used != null &&
        Object.keys(reread.features_used).length === 15,
      `${Object.keys(reread?.features_used ?? {}).length} features`,
    ],
  ];

  let failed = false;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed = true;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  }

  console.log(
    failed
      ? "\nFAILED — the forecast path is not fully working."
      : "\nOK — full stack works: Postgres -> Lambda -> Postgres.",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
