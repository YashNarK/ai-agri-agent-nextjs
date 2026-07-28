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

// ============================================================
// PREDICTION SCHEMAS
// ============================================================
export const predictionRequestSchema = z.object({
  crop_code: z.string().min(1),
  region_code: z.string().min(1),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "target_date must be YYYY-MM-DD"),
});

export type PredictionRequest = z.infer<typeof predictionRequestSchema>;

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
