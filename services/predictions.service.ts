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

    // getUTC* because price_date is a timezone-free Postgres `date`
    const year = targetDate.getUTCFullYear();
    const month = targetDate.getUTCMonth() + 1;

    return {
      crop_code: cropCode,
      region_code: regionCode,
      year,
      month,
      month_sin: Math.sin((2 * Math.PI * month) / 12.0),
      month_cos: Math.cos((2 * Math.PI * month) / 12.0),
      lag_1: prices[0],
      lag_2: prices[1],
      lag_3: prices[2],
      roll_mean_3: (prices[0] + prices[1] + prices[2]) / 3.0,
      last_volume: lastVolume,
      ...macros,
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

    const features = await this.buildFeatureRow(
      cropCode,
      regionCode,
      crop.id,
      region.id,
      targetDate,
    );

    const { predictedPrice, confidenceLow, confidenceHigh } =
      await this.scoreFeatures(features, config);

    const saved = await this.predictionRepo.create({
      cropId: crop.id,
      regionId: region.id,
      targetDate,
      predictedPrice,
      confidenceLow,
      confidenceHigh,
      modelVersion: config.model.modelName,
      featuresUsed: features,
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
    };
  }
}

export { ApiError };
