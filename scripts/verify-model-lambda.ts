// ============================================================
// scripts/verify-model-lambda.ts
//
// End-to-end check of the price model cutover: builds a feature row
// exactly as PredictionsService does, sends it through the real
// scoreFeatures() -> SigV4 -> Lambda path, and asserts the result.
//
// Touches no database and writes no prediction row — it exercises the
// scoring hop alone, which is the part that changed.
//
//   npx tsx scripts/verify-model-lambda.ts
// ============================================================

import "dotenv/config";

import type { AppConfig } from "@/lib/aws/app-config";
import { settings } from "@/lib/config/settings";
import { PredictionsService } from "@/services/predictions.service";
import { FEATURE_COLUMNS } from "@/services/price-features";

// Row 1 of the deployed artifact's input_example.json. The live Azure
// endpoint returned the values in EXPECTED for this exact input while
// it was still running, so a match proves behavioural parity.
const FEATURES: Record<string, string | number> = {
  crop_code: "BARLEY",
  region_code: "DE-GRAIN",
  year: 2020.0,
  month: 4.0,
  month_sin: 0.8660254037844387,
  month_cos: -0.4999999999999998,
  lag_1: 184.05,
  lag_2: 204.67,
  lag_3: 205.83,
  roll_mean_3: 198.1833333333333,
  last_volume: 327207.0,
  "Crude Oil Price": 26.55,
  "Fertilizer Price Index": 108.2,
  "Global Food Price Index": 95.3,
  "USD Index": 100.18,
};

const EXPECTED = {
  predictedPrice: 194.5353699300603,
  confidenceLow: 178.93444236279217,
  confidenceHigh: 207.74576820058314,
};

async function main() {
  const missing = FEATURE_COLUMNS.filter((c) => !(c in FEATURES));
  if (missing.length) throw new Error(`test row is missing: ${missing}`);

  // Only the `model` branch is read by scoreFeatures; the rest of
  // AppConfig would require a database and Secrets Manager round-trip.
  const config = {
    model: {
      functionName: settings.MODEL_FUNCTION_NAME,
      modelName: settings.MODEL_VERSION_LABEL,
    },
  } as AppConfig;

  console.log(`region   : ${settings.AWS_REGION}`);
  console.log(`function : ${config.model.functionName}`);
  console.log(
    `creds    : ${process.env.APP_AWS_ACCESS_KEY_ID ? "APP_AWS_* env" : "default provider chain"}\n`,
  );

  // Constructed with no repositories: scoreFeatures uses none of them.
  const service = new PredictionsService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  const started = Date.now();
  const got = await service.scoreFeatures(FEATURES, config);
  const elapsed = Date.now() - started;

  console.log(`invoked in ${elapsed} ms\n`);

  let failed = false;
  for (const [key, want] of Object.entries(EXPECTED) as [
    keyof typeof EXPECTED,
    number,
  ][]) {
    const actual = got[key];
    // Exact equality, not a tolerance: same pickle and same pinned
    // wheels must reproduce the same float. Drift means the artifact
    // or a dependency version changed, and that should fail loudly.
    const ok = actual === want;
    if (!ok) failed = true;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${key}\n` +
        `        expected ${want}\n` +
        `        actual   ${actual}`,
    );
  }

  console.log(
    failed
      ? "\nMISMATCH — the Lambda is not reproducing the Azure endpoint."
      : "\nPARITY CONFIRMED — exact match on all three outputs.",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
