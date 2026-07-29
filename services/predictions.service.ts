// ============================================================
// services/predictions.service.ts
//
// Crop-price prediction via the deployed MLflow model on an
// Azure ML managed online endpoint.
//
// Port of services/prediction_service.py
// ============================================================

import type { AppConfig } from "@/lib/aws/app-config";
import { settings } from "@/lib/config/settings";
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
  }: {
    cropCode?: string | null;
    regionCode?: string | null;
    limit?: number;
  }): Promise<PredictionListResponse> {
    const crop = cropCode
      ? await this.cropsService.requireCropByCode(cropCode)
      : null;
    const region = regionCode
      ? await this.regionsService.requireRegionByCode(regionCode)
      : null;

    const rows = await this.predictionRepo.list({
      cropId: crop?.id ?? null,
      regionId: region?.id ?? null,
      limit,
    });

    const predictions: LoggedPrediction[] = rows.map((row) => ({
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
    }));

    return { predictions, total: predictions.length };
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

  /** POSTs the feature row to the Azure ML endpoint and parses the result. */
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

    let response: Response;
    try {
      response = await fetch(config.azureML.endpointUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.azureML.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(settings.HTTP_CLIENT_TIMEOUT_MS),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw badGateway(`Azure ML endpoint error: ${detail}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw badGateway(
        `Azure ML endpoint error: ${response.status} ${response.statusText} ${body}`.trim(),
      );
    }

    try {
      return parsePrediction(await response.json());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw badGateway(`Azure ML endpoint error: ${detail}`);
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
      modelVersion: config.azureML.modelName,
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
