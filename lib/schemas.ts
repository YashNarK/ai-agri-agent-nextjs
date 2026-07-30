// ============================================================
// lib/schemas.ts
//
// Request/response shapes for the whole API.
//
// Pydantic did double duty in the Python app: validating request
// bodies AND declaring response shapes. Here zod handles request
// validation and TypeScript interfaces declare the responses —
// the field names and JSON output are identical to models/schemas.py.
// ============================================================

import { z } from "zod";

// ============================================================
// CROP SCHEMAS
// ============================================================
export interface CropSchema {
  id: number;
  code: string;
  name: string;
  category: string;
  sub_category: string | null;
  scientific_name: string | null;
  growing_season: string | null;
  avg_yield_per_ha: number | null;
}

export interface CropListResponse {
  crops: CropSchema[];
  total: number;
}

// ============================================================
// REGION SCHEMAS
// ============================================================
export interface RegionSchema {
  id: number;
  code: string;
  name: string;
  country: string;
  climate: string | null;
  latitude: number | null;
  longitude: number | null;
}

// ============================================================
// PRICE SCHEMAS
// ============================================================
export interface PriceHistorySchema {
  id: number;
  crop_id: number;
  region_id: number;
  price_date: string;
  price_usd_tonne: number;
  volume_traded: number | null;
  source: string | null;
}

export interface PriceHistoryResponse {
  prices: PriceHistorySchema[];
  total: number;
  crop: string;
  region: string;
}

export interface PriceStatsResponse {
  crop: string;
  region: string;
  period_start: string;
  period_end: string;
  min_price: number;
  max_price: number;
  avg_price: number;
  latest_price: number;
  price_change_pct: number;
}

/** Query params for GET /api/prices/{crop_code}/{region_code} */
export const priceHistoryQuerySchema = z.object({
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date_from must be YYYY-MM-DD")
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date_to must be YYYY-MM-DD")
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** The (crop, region) pairs that actually have price history. */
export interface AvailablePair {
  crop_code: string;
  region_code: string;
  months: number;
  start_date: string;
  end_date: string;
}

// ============================================================
// WEATHER SCHEMAS
// ============================================================
export interface WeatherSchema {
  id: number;
  region_id: number;
  weather_date: string;
  temp_max_c: number | null;
  temp_min_c: number | null;
  temp_avg_c: number | null;
  rainfall_mm: number | null;
  humidity_pct: number | null;
  wind_speed_kmh: number | null;
  solar_radiation: number | null;
  drought_index: number | null;
}

export interface WeatherResponse {
  region: string;
  region_code: string;
  observations: WeatherSchema[];
  total: number;
}

export const weatherQuerySchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(365),
});

// ============================================================
// YIELD SCHEMAS
// ============================================================
export interface YieldSchema {
  id: number;
  crop_id: number;
  region_id: number;
  region_code: string;
  region_name: string;
  harvest_year: number;
  yield_tonnes_ha: number;
  area_harvested_ha: number | null;
  total_production_tonnes: number | null;
  quality_grade: string | null;
}

export interface YieldResponse {
  crop: string;
  crop_code: string;
  yields: YieldSchema[];
  total: number;
}

export const yieldQuerySchema = z.object({
  region_code: z.string().optional(),
  year_from: z.coerce.number().int().min(1900).max(2200).optional(),
  year_to: z.coerce.number().int().min(1900).max(2200).optional(),
});

// ============================================================
// MARKET INDICATOR SCHEMAS
// ============================================================
export interface IndicatorPoint {
  indicator_date: string;
  indicator_value: number;
}

/** One indicator as a plottable series, rather than a flat row list. */
export interface IndicatorSeries {
  indicator_name: string;
  unit: string | null;
  points: IndicatorPoint[];
}

export interface IndicatorResponse {
  series: IndicatorSeries[];
  total: number;
}

export const indicatorQuerySchema = z.object({
  names: z.string().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});

// ============================================================
// PRODUCT SCHEMAS
// ============================================================
export interface ProductSchema {
  id: number;
  sku: string;
  name: string;
  category: string;
  sub_category: string | null;
  crop_id: number | null;
  crop_code: string | null;
  description: string | null;
  active_ingredient: string | null;
  unit_of_measure: string;
}

export interface ProductListResponse {
  products: ProductSchema[];
  categories: string[];
  total: number;
}

export const productQuerySchema = z.object({
  crop_code: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ============================================================
// PREDICTION SCHEMAS
// ============================================================
export const predictionRequestSchema = z.object({
  crop_code: z.string().min(1),
  region_code: z.string().min(1),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "target_date must be YYYY-MM-DD"),
});

export type PredictionRequest = z.infer<typeof predictionRequestSchema>;

/** A logged forecast, joined with the codes needed to label it. */
export interface LoggedPrediction {
  id: number;
  crop_code: string;
  crop_name: string;
  region_code: string;
  region_name: string;
  target_date: string;
  prediction_date: string;
  predicted_price: number;
  confidence_low: number | null;
  confidence_high: number | null;
  model_version: string | null;
  /** The exact feature row scored, for explainability. */
  features_used: Record<string, number | string> | null;
}

export interface PredictionListResponse {
  predictions: LoggedPrediction[];
  total: number;
}

export const predictionListQuerySchema = z.object({
  crop_code: z.string().optional(),
  region_code: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export interface PredictionResponse {
  id: number;
  crop_id: number;
  region_id: number;
  target_date: string;
  predicted_price: number;
  confidence_low: number | null;
  confidence_high: number | null;
  model_version: string | null;
  prediction_date: string;
}

// ============================================================
// SEARCH SCHEMAS
// ============================================================
export const searchRequestSchema = z.object({
  query: z.string().min(1),
  crop_code: z.string().nullish(),
  category: z.string().nullish(),
  top_k: z.number().int().min(1).max(20).default(5),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export interface SearchResult {
  id: number;
  title: string;
  content: string;
  category: string | null;
  source: string | null;
  similarity: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
}

// ============================================================
// CHAT SCHEMAS
// ============================================================
export const chatRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().nullish(),
  user_id: z.string().nullish(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ToolCallRecord {
  name: string;
  args?: Record<string, unknown>;
}

export interface ChatResponse {
  session_id: string;
  message: string;
  tool_calls: ToolCallRecord[] | null;
  sources?: Record<string, unknown>[] | null;
}

/**
 * One persisted turn-half, as the chat UI rehydrates it.
 *
 * `role` is already mapped to the AG-UI vocabulary ("user"/"assistant")
 * rather than the database's ("human"/"ai") — the mapping belongs on the
 * server, so the client never has to know two spellings of the same idea.
 */
export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface TranscriptResponse {
  session_id: string;
  messages: TranscriptMessage[];
}

/** One row in the assistant's conversation switcher. */
export interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  /**
   * Pre-formatted age ("3m", "2h", "5d").
   *
   * Computed server-side rather than in the component because reading
   * the clock during render is impure — and because stamping every row
   * against one instant keeps two rows either side of a minute boundary
   * from disagreeing about "now".
   */
  relative_age: string;
}

export interface SessionSchema {
  id: string;
  user_id: string | null;
  session_name: string | null;
  created_at: string;
}

// ============================================================
// GENERIC SCHEMAS
// ============================================================
export interface MessageResponse {
  message: string;
}

export interface ErrorDetail {
  detail: string;
}
