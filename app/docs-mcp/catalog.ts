// ============================================================
// app/docs-mcp/catalog.ts
//
// Tool catalog — the single source for the rendered docs page.
// Descriptions mirror the tool descriptions registered in
// app/api/mcp/[transport]/route.ts, with added parameter tables,
// return shapes and worked examples.
//
// Port of the TOOLS list in routers/mcp_docs.py
// ============================================================

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  desc: string;
}

export interface ToolDoc {
  name: string;
  signature: string;
  summary: string;
  description: string;
  params: ToolParam[];
  returns: string;
  exampleArgs: unknown;
  exampleResponse: unknown;
}

export const TOOLS: ToolDoc[] = [
  {
    name: "list_available_data",
    signature: "list_available_data() -> object",
    summary:
      "Discover valid crop codes, region codes, and the (crop, region) pairs that actually have price data.",
    description:
      "Call this FIRST. It returns the full vocabulary the other tools accept: " +
      "every crop code, every region code, and — crucially — the exact " +
      "(crop, region) pairs that have price history. Only pairs listed under " +
      "`available_price_pairs` can be used with get_commodity_price or " +
      "forecast_crop_price. Never guess codes that are not listed here.",
    params: [],
    returns:
      "An object with `crops` (code, name, category), `regions` " +
      "(code, name, country), and `available_price_pairs` " +
      "(crop_code, region_code, months, start_date, end_date).",
    exampleArgs: {},
    exampleResponse: {
      crops: [
        { code: "MAIZE", name: "Maize", category: "Cereals" },
        { code: "WHEAT-W", name: "Winter Wheat", category: "Cereals" },
      ],
      regions: [
        { code: "US-CORN", name: "US Corn Belt", country: "United States" },
        { code: "BR-SOY", name: "Mato Grosso", country: "Brazil" },
      ],
      available_price_pairs: [
        {
          crop_code: "MAIZE",
          region_code: "US-CORN",
          months: 139,
          start_date: "2015-01-01",
          end_date: "2026-07-01",
        },
      ],
    },
  },
  {
    name: "search_crop_knowledge",
    signature:
      "search_crop_knowledge(query: string, crop_code?: string | null) -> object",
    summary: "Hybrid (RAG) search over the agronomic knowledge base.",
    description:
      "Runs two retrievers and fuses their rankings: a pgvector " +
      "cosine-similarity search over the query's Azure OpenAI embedding, and " +
      "a Postgres full-text search over the article text. Meaning and exact " +
      "wording therefore both retrieve — a paraphrased question finds the " +
      "right article, and a pathogen name or fertiliser ratio finds the " +
      "article that names it. Pass the caller's specific terms through " +
      "verbatim rather than paraphrasing them. Optional crop_code restricts " +
      "results to a single crop.",
    params: [
      {
        name: "query",
        type: "string",
        required: true,
        desc: "Search text, e.g. 'nitrogen management for maize' or 'Puccinia triticina'.",
      },
      {
        name: "crop_code",
        type: "string | null",
        required: false,
        desc: "Optional crop filter (e.g. WHEAT-W, MAIZE). Omit for all crops.",
      },
    ],
    returns:
      "An object with `query`, `crop_code`, `mode`, `degraded`, `count` and " +
      "`results`. Each result has id, title, content, category, source, a " +
      "similarity score (0–1), the fused `score`, and `matched_by` — one of " +
      "both | semantic | keyword, i.e. which retriever surfaced it. `mode` " +
      "reports what actually ran: it reads \"keyword\" with `degraded` set " +
      "when the embedding service was unreachable and only the lexical half " +
      "of the search executed.",
    exampleArgs: {
      query: "how to manage rust disease in wheat",
      crop_code: "WHEAT-W",
    },
    exampleResponse: {
      query: "how to manage rust disease in wheat",
      crop_code: "WHEAT-W",
      mode: "hybrid",
      degraded: null,
      count: 1,
      results: [
        {
          id: 41,
          title: "Winter Wheat Disease Control Best Practices",
          content: "Preventive fungicide programs and resistant varieties ...",
          category: "disease_control",
          source: "Agronomy",
          similarity: 0.89,
          score: 0.0325,
          matched_by: "both",
        },
      ],
    },
  },
  {
    name: "get_commodity_price",
    signature:
      "get_commodity_price(crop_code: string, region_code: string) -> object",
    summary:
      "Latest 12 months of historical prices (USD/tonne) for a crop in a region.",
    description:
      "Returns the most recent 12 months of price history for a (crop, region) " +
      "pair. Only works for pairs listed by list_available_data. If the pair has " +
      "no data, the response carries an `error` message instead of failing.",
    params: [
      {
        name: "crop_code",
        type: "string",
        required: true,
        desc: "Valid crop code, e.g. MAIZE.",
      },
      {
        name: "region_code",
        type: "string",
        required: true,
        desc: "Valid region code, e.g. US-CORN.",
      },
    ],
    returns:
      "An object with `prices` (id, crop_id, region_id, price_date, " +
      "price_usd_tonne, volume_traded, source), `total`, `crop`, `region`. " +
      "On an unknown pair, `error` and `status_code` are returned instead.",
    exampleArgs: { crop_code: "MAIZE", region_code: "US-CORN" },
    exampleResponse: {
      prices: [
        {
          id: 148213,
          crop_id: 3,
          region_id: 1,
          price_date: "2026-07-01",
          price_usd_tonne: 214.86,
          volume_traded: 198450.0,
          source: "SYNTHETIC-DEMO",
        },
      ],
      total: 1,
      crop: "Maize",
      region: "US Corn Belt",
    },
  },
  {
    name: "forecast_crop_price",
    signature:
      "forecast_crop_price(crop_code: string, region_code: string, target_date: string) -> object",
    summary:
      "ML price forecast (USD/tonne) with a confidence interval, via Azure ML.",
    description:
      "Builds model features from recent price history + macro indicators and " +
      "calls the Azure ML managed online endpoint (Gradient Boosting model). " +
      "Requires existing price history for the pair (see list_available_data). " +
      "Returns a predicted price with confidence bounds, or a clear error — " +
      "never a fabricated value.",
    params: [
      {
        name: "crop_code",
        type: "string",
        required: true,
        desc: "Valid crop code, e.g. MAIZE.",
      },
      {
        name: "region_code",
        type: "string",
        required: true,
        desc: "Valid region code, e.g. US-CORN.",
      },
      {
        name: "target_date",
        type: "string",
        required: true,
        desc: "Future date to forecast, format YYYY-MM-DD.",
      },
    ],
    returns:
      "An object with crop_id, region_id, target_date, predicted_price, " +
      "confidence_low, confidence_high, model_version, prediction_date. " +
      "On bad input or a pair with no history, an `error` is returned instead.",
    exampleArgs: {
      crop_code: "MAIZE",
      region_code: "US-CORN",
      target_date: "2026-12-01",
    },
    exampleResponse: {
      id: 752,
      crop_id: 3,
      region_id: 1,
      target_date: "2026-12-01",
      predicted_price: 221.47,
      confidence_low: 203.75,
      confidence_high: 239.19,
      model_version: "crop-price-gbr",
      prediction_date: "2026-07-27T10:15:00Z",
    },
  },
  {
    name: "get_agronomic_advice",
    signature:
      "get_agronomic_advice(crop_code: string, issue: string) -> object",
    summary:
      "Evidence-based advice for a specific crop issue, via hybrid search.",
    description:
      "Searches the knowledge base for guidance on a specific issue for a crop. " +
      "First tries crop-specific articles; if none are found it falls back to " +
      "general best-practice guidance (scope='general') rather than returning " +
      "nothing. Never fabricates recommendations.",
    params: [
      {
        name: "crop_code",
        type: "string",
        required: true,
        desc: "Valid crop code, e.g. MAIZE.",
      },
      {
        name: "issue",
        type: "string",
        required: true,
        desc:
          "Issue to advise on. Underscores are treated as spaces, e.g. " +
          "rust_disease, nitrogen_deficiency, irrigation_scheduling.",
      },
    ],
    returns:
      "An object with crop_code, issue, scope ('crop_specific' or 'general'), an " +
      "optional note, and `recommendations` (knowledge-base articles).",
    exampleArgs: { crop_code: "MAIZE", issue: "nitrogen_deficiency" },
    exampleResponse: {
      crop_code: "MAIZE",
      issue: "nitrogen_deficiency",
      scope: "crop_specific",
      note: null,
      recommendations: [
        {
          id: 12,
          title: "Maize Fertilization Best Practices",
          content:
            "Split nitrogen applications matched to maize growth stages ...",
          category: "fertilization",
          source: "Agronomy",
          similarity: 0.86,
          matched_by: "both",
        },
      ],
    },
  },
];
