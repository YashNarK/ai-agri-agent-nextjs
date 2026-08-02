// ============================================================
// services/predictions.service.ts
//
// Crop-price prediction via the deployed MLflow model, running as a
// container-image Lambda (agri-price-model) invoked with SigV4.
//
// Replaced an Azure ML managed online endpoint, which held a
// Standard_DS2_v2 VM 24×7 — ~₹5,400/month — to serve a 1.1 MB
// scikit-learn model. Same artifact, verified to reproduce that
// endpoint's predictions to all 16 significant digits.
//
// Port of services/prediction_service.py
// ============================================================

import {
  InvokeCommand,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";

import type { AppConfig } from "@/lib/aws/app-config";
import { lambdaClient } from "@/lib/aws/lambda-client";
import { ApiError, badGateway, unprocessable } from "@/lib/errors";
import type {
  LoggedPrediction,
  PredictionListResponse,
  PredictionResponse,
} from "@/lib/schemas";
import { toDateString, toNumber, toNumberOrNull } from "@/lib/serialize";
import type { MarketIndicatorRepository } from "@/repositories/market-indicator.repository";
import type { PredictionRepository } from "@/repositories/prediction.repository";
import type { PriceRepository } from "@/repositories/price.repository";
import type { CropsService } from "@/services/crops.service";
import { FEATURE_COLUMNS, MACRO_INDICATORS } from "@/services/price-features";
import type { RegionsService } from "@/services/regions.service";

/**
 * Fallback macro values if market_indicators has no row on/before the
 * target date (keeps the model servable in dev).
 * Keys MUST match MACRO_INDICATORS in services/price-features.ts.
 */
const MACRO_FALLBACKS: Record<string, number> = {
  "Crude Oil Price": 80.0,
  "Fertilizer Price Index": 150.0,
  "Global Food Price Index": 120.0,
  "USD Index": 102.0,
};

export type FeatureRow = Record<string, string | number>;

/**
 * How far past the end of price history a forecast may be rolled.
 *
 * Each recursive step feeds the previous step's prediction back in as a
 * lag, so error compounds: by two years out the model is mostly reading
 * its own output. Refusing beyond this is the same principle as
 * refusing a pair with no history at all — better no number than a
 * confident one nobody should act on.
 */
export const MAX_FORECAST_HORIZON_MONTHS = 24;

/**
 * Where a forecast's inputs came from, and how far it reached.
 *
 * Carried alongside every prediction because the number alone is not
 * interpretable: $639 for 2027 built from prices ending July 2026 is a
 * 38-month extrapolation, and a reader who cannot see that will treat
 * it as a reading rather than a projection.
 */
export interface ForecastProvenance {
  /** Last actual observed price date for the pair, YYYY-MM-DD. */
  last_history_date: string;
  /** Months of recorded history behind the forecast. */
  history_months: number;
  /** Monthly steps rolled forward past `last_history_date`; 0 = in-sample. */
  months_extrapolated: number;
  /** `recursive` rolled predictions forward; `direct` scored once. */
  method: "direct" | "recursive";
}

export interface ForecastPlan {
  /** Oldest-first, one row per monthly step. The last row is the target. */
  steps: FeatureRow[];
  provenance: ForecastProvenance;
}

/** Whole months from `from` to `to`, ignoring day-of-month. */
function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  );
}

/** `base` advanced by `count` months, normalised to the first of the month. */
function addMonths(base: Date, count: number): Date {
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + count, 1),
  );
}

/** A persisted forecast row, with its crop and region, as the API shape. */
type PredictionRow = NonNullable<
  Awaited<ReturnType<PredictionRepository["findById"]>>
>;

/** One place that maps a row to LoggedPrediction, used by list and by id. */
function toLoggedPrediction(row: PredictionRow): LoggedPrediction {
  return {
    id: Number(row.id),
    crop_code: row.crops.code,
    crop_name: row.crops.name,
    region_code: row.regions.code,
    region_name: row.regions.name,
    target_date: toDateString(row.target_date),
    prediction_date: row.prediction_date.toISOString(),
    predicted_price: toNumber(row.predicted_price),
    confidence_low: toNumberOrNull(row.confidence_low),
    confidence_high: toNumberOrNull(row.confidence_high),
    model_version: row.model_version,
    features_used: (row.features_used ?? null) as Record<
      string,
      number | string
    > | null,
  };
}

interface ParsedPrediction {
  predictedPrice: number;
  confidenceLow: number | null;
  confidenceHigh: number | null;
}

/**
 * Normalises whatever shape the MLflow scoring endpoint returns:
 * `{predictions: [...]}`, `{outputs: [...]}`, a bare list of records,
 * a list of triples, or a single scalar.
 */
export function parsePrediction(payload: unknown): ParsedPrediction {
  let records: unknown = payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    records = obj.predictions ?? obj.outputs ?? obj;
  }

  const first =
    Array.isArray(records) && records.length > 0 ? records[0] : records;

  let pred: unknown;
  let low: unknown = null;
  let high: unknown = null;

  if (Array.isArray(first)) {
    [pred, low, high] = first;
  } else if (first && typeof first === "object") {
    const row = first as Record<string, unknown>;
    if (row.predicted_price === undefined || row.predicted_price === null) {
      const values = Object.values(row);
      [pred, low, high] = values;
    } else {
      pred = row.predicted_price;
      low = row.confidence_low ?? null;
      high = row.confidence_high ?? null;
    }
  } else {
    pred = first;
  }

  return {
    predictedPrice: Number(pred),
    confidenceLow: low === null || low === undefined ? null : Number(low),
    confidenceHigh: high === null || high === undefined ? null : Number(high),
  };
}

export interface PredictPriceInput {
  cropCode: string;
  regionCode: string;
  targetDate: Date;
  config: AppConfig;
}

export class PredictionsService {
  constructor(
    private readonly priceRepo: PriceRepository,
    private readonly marketIndicatorRepo: MarketIndicatorRepository,
    private readonly predictionRepo: PredictionRepository,
    private readonly cropsService: CropsService,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * Browses forecasts already logged, without calling Azure ML.
   *
   * Every prediction this service serves is persisted with the exact
   * feature row that produced it, so the history is fully explainable
   * after the fact — and reading it costs nothing.
   */
  async listPredictions({
    cropCode,
    regionCode,
    limit,
    page = 1,
    search,
  }: {
    cropCode?: string | null;
    regionCode?: string | null;
    limit?: number;
    /** 1-based. Out-of-range pages return an empty list, not an error. */
    page?: number;
    search?: string | null;
  }): Promise<PredictionListResponse> {
    const crop = cropCode
      ? await this.cropsService.requireCropByCode(cropCode)
      : null;
    const region = regionCode
      ? await this.regionsService.requireRegionByCode(regionCode)
      : null;

    const filter = {
      cropId: crop?.id ?? null,
      regionId: region?.id ?? null,
      search,
    };

    // `total` is the count of everything MATCHING, not the length of this
    // page — the pager needs to know how many pages exist, and the two
    // numbers stopped being the same once paging arrived.
    const [rows, total] = await Promise.all([
      this.predictionRepo.list({
        ...filter,
        limit,
        skip: Math.max(0, (page - 1) * (limit ?? 100)),
      }),
      this.predictionRepo.count(filter),
    ]);

    return { predictions: rows.map(toLoggedPrediction), total };
  }

  /**
   * One logged forecast by id, or null.
   *
   * Separate from listPredictions because the selected forecast is
   * addressed by id in the URL and need not appear in the page being
   * shown — a search filter or a later page both hide it.
   */
  async getPrediction(id: number): Promise<LoggedPrediction | null> {
    const row = await this.predictionRepo.findById(id);
    if (!row) return null;
    return toLoggedPrediction(row);
  }

  /**
   * Latest value on/before targetDate for each macro indicator,
   * falling back to MACRO_FALLBACKS when the table has no row.
   */
  private async latestMacros(targetDate: Date): Promise<Record<string, number>> {
    const entries = await Promise.all(
      MACRO_INDICATORS.map(async (name) => {
        const row = await this.marketIndicatorRepo.findLatestValue(
          name,
          targetDate,
        );
        const value = row ? toNumber(row.indicator_value) : MACRO_FALLBACKS[name];
        return [name, value] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  /**
   * A resolver for "latest macro value on/before date", backed by one
   * query instead of one per step.
   *
   * A 24-step roll-forward needs macros at 24 different dates. Asking
   * findLatestValue for each would be 96 round trips to answer from a
   * few hundred rows, so the series is pulled once and walked in memory.
   */
  private async macroResolver(
    upTo: Date,
  ): Promise<(at: Date) => Record<string, number>> {
    const rows = await this.marketIndicatorRepo.findSeries({
      names: [...MACRO_INDICATORS],
      dateTo: upTo,
    });

    // ascending per name, so the last entry at or before a date wins
    const byName = new Map<string, { date: Date; value: number }[]>();
    for (const row of rows) {
      const list = byName.get(row.indicator_name) ?? [];
      list.push({
        date: row.indicator_date,
        value: toNumber(row.indicator_value),
      });
      byName.set(row.indicator_name, list);
    }

    return (at: Date) => {
      const macros: Record<string, number> = {};
      for (const name of MACRO_INDICATORS) {
        const series = byName.get(name) ?? [];
        let value: number | undefined;
        for (const point of series) {
          if (point.date.getTime() <= at.getTime()) value = point.value;
          else break;
        }
        macros[name] = value ?? MACRO_FALLBACKS[name];
      }
      return macros;
    };
  }

  /**
   * Builds the exact feature row the model was trained on:
   * three price lags, a 3-period rolling mean, cyclic month encoding,
   * last traded volume, and the macro indicators.
   *
   * Throws 422 when the pair has no prior price history — the model
   * must never be handed fabricated lags.
   */
  async buildFeatureRow(
    cropCode: string,
    regionCode: string,
    cropId: number,
    regionId: number,
    targetDate: Date,
  ): Promise<FeatureRow> {
    const history = await this.priceRepo.findRecentBefore(
      cropId,
      regionId,
      targetDate,
      3,
    );

    if (history.length === 0) {
      throw unprocessable(
        `No price history for ${cropCode}/${regionCode} before ` +
          `${toDateString(targetDate)}; cannot build prediction features`,
      );
    }

    // pad short history by repeating the oldest known price, exactly
    // as the training pipeline did
    const prices = history.map((row) => toNumber(row.price_usd_tonne));
    while (prices.length < 3) {
      prices.push(prices[prices.length - 1]);
    }

    const lastVolume = toNumberOrNull(history[0].volume_traded) ?? 0.0;
    const macros = await this.latestMacros(targetDate);

    return this.assembleRow({
      cropCode,
      regionCode,
      at: targetDate,
      lags: [prices[0], prices[1], prices[2]],
      lastVolume,
      macros,
    });
  }

  /** The 15-column row, assembled in the order the model was fitted on. */
  private assembleRow({
    cropCode,
    regionCode,
    at,
    lags,
    lastVolume,
    macros,
  }: {
    cropCode: string;
    regionCode: string;
    at: Date;
    lags: [number, number, number];
    lastVolume: number;
    macros: Record<string, number>;
  }): FeatureRow {
    // getUTC* because price_date is a timezone-free Postgres `date`
    const year = at.getUTCFullYear();
    const month = at.getUTCMonth() + 1;

    return {
      crop_code: cropCode,
      region_code: regionCode,
      year,
      month,
      month_sin: Math.sin((2 * Math.PI * month) / 12.0),
      month_cos: Math.cos((2 * Math.PI * month) / 12.0),
      lag_1: lags[0],
      lag_2: lags[1],
      lag_3: lags[2],
      roll_mean_3: (lags[0] + lags[1] + lags[2]) / 3.0,
      last_volume: lastVolume,
      ...macros,
    };
  }

  /**
   * Plans a forecast: the monthly steps to score, and the provenance
   * needed to describe the result honestly.
   *
   * A target within (or one month past) the history end is a single
   * direct score — that is exactly what the model was trained to do.
   * Further out it becomes a roll-forward, one row per month, because
   * scoring a distant date against unchanged lags does not extrapolate:
   * every future row would be identical except `year`, and the tree
   * ensemble returns the same number for every year past its training
   * range.
   *
   * Throws 422 when the pair has no history at all, and again when the
   * horizon exceeds what a compounding roll-forward can honestly carry.
   */
  async buildForecastPlan(
    cropCode: string,
    regionCode: string,
    cropId: number,
    regionId: number,
    targetDate: Date,
  ): Promise<ForecastPlan> {
    const [history, bounds] = await Promise.all([
      this.priceRepo.findRecentBefore(cropId, regionId, targetDate, 3),
      this.priceRepo.historyBounds(cropId, regionId),
    ]);

    if (history.length === 0 || !bounds.last) {
      throw unprocessable(
        `No price history for ${cropCode}/${regionCode} before ` +
          `${toDateString(targetDate)}; cannot build prediction features`,
      );
    }

    const prices = history.map((row) => toNumber(row.price_usd_tonne));
    while (prices.length < 3) prices.push(prices[prices.length - 1]);
    const lags: [number, number, number] = [prices[0], prices[1], prices[2]];
    const lastVolume = toNumberOrNull(history[0].volume_traded) ?? 0.0;

    // measured from the last observation the lags actually came from,
    // not from the pair's overall max — for a target inside the series
    // those differ, and only the former bounds the roll-forward
    const anchor = history[0].price_date;
    const horizon = monthsBetween(anchor, targetDate);

    if (horizon > MAX_FORECAST_HORIZON_MONTHS) {
      throw unprocessable(
        `${cropCode}/${regionCode} price history ends ${toDateString(bounds.last)}, ` +
          `so ${toDateString(targetDate)} is ${horizon} months beyond it. This model ` +
          `forecasts one month ahead and is rolled forward step by step, which ` +
          `compounds error — it will not forecast further than ` +
          `${MAX_FORECAST_HORIZON_MONTHS} months past the last observed price. ` +
          `Pick a nearer target date.`,
      );
    }

    const provenanceBase = {
      last_history_date: toDateString(bounds.last),
      history_months: bounds.months,
      months_extrapolated: Math.max(0, horizon),
    };

    // One step ahead (or inside the series) is the model's native
    // question — no roll-forward needed, and none should be invented.
    if (horizon <= 1) {
      const macros = await this.latestMacros(targetDate);
      return {
        steps: [
          this.assembleRow({
            cropCode,
            regionCode,
            at: targetDate,
            lags,
            lastVolume,
            macros,
          }),
        ],
        provenance: { ...provenanceBase, method: "direct" },
      };
    }

    const macrosAt = await this.macroResolver(targetDate);
    const steps: FeatureRow[] = [];
    for (let step = 1; step <= horizon; step++) {
      const at = addMonths(anchor, step);
      steps.push(
        this.assembleRow({
          cropCode,
          regionCode,
          at,
          // only the first row's lags are honoured; the Lambda overwrites
          // the rest as it rolls each prediction forward
          lags,
          lastVolume,
          macros: macrosAt(at),
        }),
      );
    }

    return {
      steps,
      provenance: { ...provenanceBase, method: "recursive" },
    };
  }

  /**
   * Invokes the model Lambda with the feature row and parses the result.
   *
   * Direct SigV4 invoke, not HTTP: the function has no public endpoint
   * and no API key. AWS authorises the caller from the credentials in
   * lib/aws/lambda-client.ts before the handler runs, so there is no
   * bearer token to leak, rotate, or accidentally publish.
   *
   * The payload IS the event — the handler returns a bare
   * {"predictions": [...]} for direct invokes rather than an HTTP
   * envelope.
   */
  async scoreFeatures(
    features: FeatureRow,
    config: AppConfig,
  ): Promise<ParsedPrediction> {
    const payload = {
      input_data: {
        columns: FEATURE_COLUMNS,
        data: [FEATURE_COLUMNS.map((col) => features[col])],
      },
    };

    let response: InvokeCommandOutput;
    try {
      response = await lambdaClient().send(
        new InvokeCommand({
          FunctionName: config.model.functionName,
          // RequestResponse = synchronous. The default would be Event,
          // which fires and forgets and returns no prediction at all.
          InvocationType: "RequestResponse",
          Payload: JSON.stringify(payload),
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw badGateway(`Price model error: ${detail}`);
    }

    const raw = response.Payload
      ? Buffer.from(response.Payload).toString("utf-8")
      : "";

    // A handler exception still returns HTTP 200 from the Lambda API —
    // the failure is signalled by FunctionError, and Payload holds the
    // Python traceback. Without this check a crash would be parsed as
    // if it were a prediction.
    if (response.FunctionError) {
      throw badGateway(`Price model error: ${response.FunctionError} ${raw}`.trim());
    }

    try {
      return parsePrediction(JSON.parse(raw));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw badGateway(`Price model error: ${detail}`);
    }
  }

  /**
   * Scores a whole forecast plan in ONE invocation and returns the path.
   *
   * The roll-forward runs inside the Lambda rather than here. Each step
   * depends on the previous step's output, so it cannot be batched or
   * parallelised — done from this process it would be one HTTPS
   * round-trip per month (~170ms each, so ~4s for two years). In-process
   * the same steps are microseconds apart, and the whole path costs a
   * single invocation.
   *
   * Returns every step, not just the last: the intermediate months are
   * the forecast trajectory, which is worth showing and worth logging.
   */
  async scoreForecastPath(
    plan: ForecastPlan,
    config: AppConfig,
  ): Promise<ParsedPrediction[]> {
    const payload = {
      recursive: plan.provenance.method === "recursive",
      input_data: {
        columns: FEATURE_COLUMNS,
        data: plan.steps.map((step) => FEATURE_COLUMNS.map((col) => step[col])),
      },
    };

    let response: InvokeCommandOutput;
    try {
      response = await lambdaClient().send(
        new InvokeCommand({
          FunctionName: config.model.functionName,
          InvocationType: "RequestResponse",
          Payload: JSON.stringify(payload),
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw badGateway(`Price model error: ${detail}`);
    }

    const raw = response.Payload
      ? Buffer.from(response.Payload).toString("utf-8")
      : "";

    if (response.FunctionError) {
      throw badGateway(`Price model error: ${response.FunctionError} ${raw}`.trim());
    }

    let records: unknown[];
    try {
      const body = JSON.parse(raw) as { predictions?: unknown };
      records = Array.isArray(body.predictions) ? body.predictions : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw badGateway(`Price model error: ${detail}`);
    }

    if (records.length !== plan.steps.length) {
      throw badGateway(
        `Price model error: asked for ${plan.steps.length} step(s), got ` +
          `${records.length}`,
      );
    }

    return records.map((record) => parsePrediction(record));
  }

  /**
   * Full prediction flow: resolve codes → build features → score →
   * log the forecast to price_predictions for audit → return it.
   */
  async predictPrice({
    cropCode,
    regionCode,
    targetDate,
    config,
  }: PredictPriceInput): Promise<PredictionResponse> {
    const crop = await this.cropsService.requireCropByCode(cropCode);
    const region = await this.regionsService.requireRegionByCode(regionCode);

    const plan = await this.buildForecastPlan(
      cropCode,
      regionCode,
      crop.id,
      region.id,
      targetDate,
    );

    const path = await this.scoreForecastPath(plan, config);
    // the target is the last step; the earlier ones are the trajectory
    const { predictedPrice, confidenceLow, confidenceHigh } = path[path.length - 1];

    const saved = await this.predictionRepo.create({
      cropId: crop.id,
      regionId: region.id,
      targetDate,
      predictedPrice,
      confidenceLow,
      confidenceHigh,
      modelVersion: config.model.modelName,
      // the row that produced the answer, plus how it was reached — a
      // stored feature row without the horizon is not enough to explain
      // a 24-month roll-forward after the fact
      featuresUsed: {
        ...plan.steps[plan.steps.length - 1],
        ...plan.provenance,
      },
    });

    return {
      id: Number(saved.id),
      crop_id: saved.crop_id,
      region_id: saved.region_id,
      target_date: toDateString(saved.target_date),
      predicted_price: toNumber(saved.predicted_price),
      confidence_low: toNumberOrNull(saved.confidence_low),
      confidence_high: toNumberOrNull(saved.confidence_high),
      model_version: saved.model_version,
      prediction_date: saved.prediction_date.toISOString(),
      provenance: plan.provenance,
    };
  }
}

export { ApiError };
