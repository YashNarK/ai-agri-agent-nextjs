// ============================================================
// agents/artifacts.ts
//
// Structured payloads the agent's tools carry ALONGSIDE their prose.
//
// WHY THIS EXISTS
//
// The tools return prose on purpose — the model reads those strings
// directly, and that wording is production-proven, so it must not
// change. But prose is useless to a chart: rendering a forecast in the
// chat transcript needs numbers, and scraping them back out of
// "Predicted price : $253.26/tonne" with a regex would be a silent
// breakage waiting for the day someone reformats a string.
//
// LangChain's `content_and_artifact` response format solves exactly
// this. A tool returns `[content, artifact]`: the model still sees only
// `content`, and `artifact` rides along on the ToolMessage untouched.
// So the agent's behaviour is bit-for-bit identical while the UI gains
// a typed payload.
//
// This module is deliberately dependency-free and carries no
// "use client" — the tools import it on the server and the chat
// renderers import it on the client.
// ============================================================

/** Every artifact is tagged so a renderer can switch on one field. */
export type ToolArtifact =
  | AvailabilityArtifact
  | PriceHistoryArtifact
  | ForecastArtifact
  | KnowledgeArtifact
  | WeatherArtifact
  | IndicatorsArtifact;

export interface AvailabilityArtifact {
  kind: "availability";
  crops: { code: string; name: string; category: string }[];
  regions: { code: string; name: string; country: string }[];
  pairs: {
    crop_code: string;
    region_code: string;
    months: number;
    start_date: string;
    end_date: string;
  }[];
}

export interface PriceHistoryArtifact {
  kind: "price_history";
  crop: string;
  region: string;
  crop_code: string;
  region_code: string;
  /** Oldest → newest, so a chart can plot it without re-sorting. */
  points: {
    price_date: string;
    price_usd_tonne: number;
    volume_traded: number | null;
  }[];
  latest: number;
  change_pct: number;
}

export interface ForecastArtifact {
  kind: "forecast";
  crop: string;
  region: string;
  crop_code: string;
  region_code: string;
  target_date: string;
  predicted_price: number;
  /**
   * Null when the model returned no interval — rendered as a bare point
   * rather than a zero-width band, because a zero-width band reads as
   * "perfectly certain" when the truth is "not reported".
   */
  confidence_low: number | null;
  confidence_high: number | null;
  /**
   * Last date this pair has an ACTUAL observed price, and how many
   * monthly steps the forecast was rolled past it.
   *
   * Rendered as a badge rather than kept for debugging: a 24-month
   * extrapolation and a one-month-ahead forecast look identical on a
   * chart, and only one of them should be acted on.
   */
  last_history_date: string;
  months_extrapolated: number;
}

export interface KnowledgeArtifact {
  kind: "knowledge";
  query: string;
  /** Which retrievers ran — "keyword" alone means the embedding call failed. */
  mode: "hybrid" | "semantic" | "keyword";
  degraded: boolean;
  results: {
    title: string;
    category: string | null;
    source: string | null;
    /** Null only when no query vector existed to measure against. */
    similarity: number | null;
    /**
     * Which retriever(s) surfaced this row. Shown in the transcript
     * because "both retrievers agreed" is a materially stronger claim
     * than "one of them ranked it fifth", and the reader is entitled to
     * that distinction when deciding whether to trust the citation.
     */
    matched_by: "both" | "semantic" | "keyword";
    excerpt: string;
  }[];
}

export interface WeatherArtifact {
  kind: "weather";
  region: string;
  region_code: string;
  records: {
    weather_date: string;
    temp_avg_c: number | null;
    rainfall_mm: number | null;
    drought_index: number | null;
  }[];
}

export interface IndicatorsArtifact {
  kind: "indicators";
  indicators: {
    indicator_name: string;
    indicator_value: number;
    unit: string | null;
    indicator_date: string;
  }[];
}

/**
 * Narrows an unknown ToolMessage `artifact` field to a ToolArtifact.
 *
 * The artifact crosses a serialisation boundary (server → SSE → client)
 * where its type is erased to `unknown`, so it is checked rather than
 * cast. A tool that returned no artifact — an error or no-data path —
 * yields null here, and the renderer falls back to showing the prose.
 */
export function asToolArtifact(value: unknown): ToolArtifact | null {
  if (typeof value !== "object" || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string") return null;
  const known: ToolArtifact["kind"][] = [
    "availability",
    "price_history",
    "forecast",
    "knowledge",
    "weather",
    "indicators",
  ];
  return known.includes(kind as ToolArtifact["kind"])
    ? (value as ToolArtifact)
    : null;
}
