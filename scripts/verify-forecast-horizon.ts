// ============================================================
// scripts/verify-forecast-horizon.ts
//
// Checks the three behaviours the horizon work introduced:
//
//   1. provenance  — every forecast reports where its inputs end and
//                    how far past them it reached
//   2. guard       — targets beyond MAX_FORECAST_HORIZON_MONTHS are
//                    refused rather than answered
//   3. roll-forward— distinct future dates get DISTINCT forecasts,
//                    which was the reported bug
//
//   npx tsx scripts/verify-forecast-horizon.ts
// ============================================================

import "dotenv/config";

import { loadAppConfig } from "@/lib/aws/app-config";
import { container } from "@/lib/container";
import {
  MAX_FORECAST_HORIZON_MONTHS,
} from "@/services/predictions.service";
import { parseDateOnly } from "@/lib/serialize";

const CROP = "RICE";
const REGION = "US-SOUTH";

const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const config = await loadAppConfig();
  const crop = await container.cropsService.requireCropByCode(CROP);
  const region = await container.regionsService.requireRegionByCode(REGION);

  // one month past the last observed price: the model's native question,
  // so this must score directly rather than roll anything forward
  const plan1 = await container.predictionsService.buildForecastPlan(
    CROP,
    REGION,
    crop.id,
    region.id,
    parseDateOnly("2026-08-01"),
  );
  const lastHistory = plan1.provenance.last_history_date;
  console.log(`history ends : ${lastHistory}`);
  console.log(`history size : ${plan1.provenance.history_months} months`);
  console.log(`max horizon  : ${MAX_FORECAST_HORIZON_MONTHS} months\n`);

  // -- 1. provenance -------------------------------------------------
  console.log("== provenance ==");
  check(
    "reports last_history_date",
    /^\d{4}-\d{2}-\d{2}$/.test(lastHistory),
    lastHistory,
  );
  check(
    "reports months_extrapolated",
    typeof plan1.provenance.months_extrapolated === "number",
    String(plan1.provenance.months_extrapolated),
  );
  check(
    "one month ahead uses direct scoring (no roll-forward invented)",
    plan1.provenance.method === "direct",
    `${plan1.provenance.method}, +${plan1.provenance.months_extrapolated}mo`,
  );
  check(
    "direct plan is a single step",
    plan1.steps.length === 1,
    `${plan1.steps.length} step(s)`,
  );

  // -- 2. horizon guard ----------------------------------------------
  console.log("\n== horizon guard ==");
  let refused = false;
  let message = "";
  try {
    await container.predictionsService.buildForecastPlan(
      CROP,
      REGION,
      crop.id,
      region.id,
      parseDateOnly("2029-09-01"),
    );
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check("2029-09-01 refused (was silently answered before)", refused);
  check(
    "refusal explains why",
    /months beyond|will not forecast/i.test(message),
    message.slice(0, 90) + "…",
  );

  // -- 3. roll-forward gives DISTINCT answers -------------------------
  console.log("\n== roll-forward produces distinct forecasts ==");
  const dates = ["2026-12-01", "2027-03-01", "2027-06-01"];
  const results: { date: string; price: number; months: number; method: string }[] =
    [];

  for (const date of dates) {
    const plan = await container.predictionsService.buildForecastPlan(
      CROP,
      REGION,
      crop.id,
      region.id,
      parseDateOnly(date),
    );
    const path = await container.predictionsService.scoreForecastPath(plan, config);
    results.push({
      date,
      price: path[path.length - 1].predictedPrice,
      months: plan.provenance.months_extrapolated,
      method: plan.provenance.method,
    });
  }

  for (const r of results) {
    console.log(
      `  ${r.date}  $${r.price.toFixed(2).padStart(9)}  ` +
        `+${String(r.months).padStart(2)} months  ${r.method}`,
    );
  }

  const distinct = new Set(results.map((r) => r.price.toFixed(6)));
  check(
    "three future dates give three DIFFERENT prices",
    distinct.size === results.length,
    `${distinct.size}/${results.length} distinct`,
  );
  check(
    "far dates use recursive scoring",
    results.every((r) => (r.months >= 2 ? r.method === "recursive" : true)),
  );
  check(
    "months_extrapolated increases with target date",
    results[0].months < results[1].months && results[1].months < results[2].months,
    results.map((r) => r.months).join(" < "),
  );

  console.log(
    failures.length === 0
      ? "\nALL PASSED"
      : `\nFAILURES: ${failures.join(", ")}`,
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
