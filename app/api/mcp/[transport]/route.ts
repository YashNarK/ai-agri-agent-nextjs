// ============================================================
// app/api/mcp/[transport]/route.ts
//
// MCP server — exposes the platform's capabilities to external AI
// models (Claude, GPT, etc.) over the Model Context Protocol.
//
// These tools mirror the LangGraph tools but return structured JSON
// instead of prose, and reuse the SAME service layer the REST API and
// the agent use — so there is a single source of truth for the
// query/prediction/search logic.
//
// FastAPI mounted a FastMCP ASGI app at /mcp and chained its lifespan.
// mcp-handler is the equivalent for route handlers: [transport]
// resolves to /api/mcp/mcp (streamable HTTP) and /api/mcp/sse.
//
// Resource lifecycle: config, DB and services resolve lazily on the
// first tool call, exactly as the Python server's _get_resources did —
// config loading is async and hits AWS, so it cannot happen at import.
//
// Port of mcp_server/server.py
// ============================================================

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { requireMcpToken } from "@/lib/auth/mcp-token";
import { loadAppConfig } from "@/lib/aws/app-config";
import { container } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { parseDateOnly, toDateString } from "@/lib/serialize";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Every tool returns JSON as its text content, MCP-style. */
const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

/** ApiError → the {error, status_code} shape the Python tools returned. */
const asToolError = (error: unknown) => {
  if (error instanceof ApiError) {
    return { error: error.detail, status_code: error.status };
  }
  return { error: error instanceof Error ? error.message : String(error) };
};

const handler = createMcpHandler(
  (server) => {
    // --------------------------------------------------------
    server.tool(
      "list_available_data",
      "List valid crop codes, region codes, and the exact (crop, region) " +
        "pairs that actually have price data. Call this first: only the pairs " +
        "under `available_price_pairs` can be used with get_commodity_price or " +
        "forecast_crop_price. Never guess codes that are not listed here.",
      {},
      async () => {
        const [crops, regions, pairs] = await Promise.all([
          container.cropRepo.listCodes(),
          container.regionRepo.listCodes(),
          container.priceRepo.findAvailablePairs(),
        ]);

        return json({
          crops,
          regions,
          available_price_pairs: pairs.map((p) => ({
            crop_code: p.crop_code,
            region_code: p.region_code,
            months: Number(p.months),
            start_date: toDateString(p.start_date),
            end_date: toDateString(p.end_date),
          })),
        });
      },
    );

    // --------------------------------------------------------
    server.tool(
      "search_crop_knowledge",
      "Search the agronomic knowledge base (hybrid RAG search). " +
        "Returns relevant articles about crop management, pest control, " +
        "disease management, soil health and best practices, ranked by " +
        "fusing vector similarity with full-text relevance — so exact " +
        "terms (a pathogen name, a fertiliser ratio) match as well as " +
        "paraphrases do. Pass the user's specific wording through " +
        "verbatim. Each result reports matched_by: both | semantic | " +
        "keyword. crop_code is optional (e.g. WHEAT-W, MAIZE, SORGHUM); " +
        "call list_available_data for valid codes.",
      {
        query: z.string(),
        crop_code: z.string().nullish(),
      },
      async ({ query, crop_code }) => {
        const config = await loadAppConfig();
        const { results, mode, degraded } = await container.searchService.search({
          query,
          config: config.azureOpenAI,
          cropCode: crop_code,
          topK: 5,
          mode: "hybrid",
        });

        return json({
          query,
          crop_code: crop_code ?? null,
          // The client is another AI system, so a silent fallback is
          // worse here than in the UI: it would present keyword-only
          // recall as the full result and never know to say so.
          mode,
          degraded: degraded?.reason ?? null,
          count: results.length,
          results,
        });
      },
    );

    // --------------------------------------------------------
    server.tool(
      "get_commodity_price",
      "Get historical commodity prices (USD/tonne) for a crop in a region. " +
        "Only works for pairs listed by list_available_data, e.g. " +
        "SORGHUM @ US-SOUTH, COTTON @ US-SOUTH, MAIZE @ US-CORN, SOY @ BR-SOY. " +
        "Returns the latest 12 months of price history or an error if the " +
        "crop/region/pair has no data.",
      {
        crop_code: z.string(),
        region_code: z.string(),
      },
      async ({ crop_code, region_code }) => {
        let response;
        try {
          response = await container.pricesService.getPriceHistory({
            cropCode: crop_code,
            regionCode: region_code,
            limit: 12,
          });
        } catch (error) {
          return json(asToolError(error));
        }

        if (response.prices.length === 0) {
          return json({
            ...response,
            error:
              `No price history for ${crop_code} @ ${region_code}. ` +
              "Call list_available_data for pairs that have data.",
          });
        }
        return json(response);
      },
    );

    // --------------------------------------------------------
    server.tool(
      "forecast_crop_price",
      "Forecast a future commodity price using the Azure ML model. " +
        "target_date format: YYYY-MM-DD. Requires existing price history for " +
        "the crop/region pair (see list_available_data). Returns predicted " +
        "price with a confidence interval, or a clear error if the pair has " +
        "no data — never a fabricated value.",
      {
        crop_code: z.string(),
        region_code: z.string(),
        target_date: z.string(),
      },
      async ({ crop_code, region_code, target_date }) => {
        let targetDate: Date;
        try {
          targetDate = parseDateOnly(target_date);
        } catch {
          return json({
            error: `Invalid target_date '${target_date}'. Use YYYY-MM-DD.`,
          });
        }

        try {
          const config = await loadAppConfig();
          return json(
            await container.predictionsService.predictPrice({
              cropCode: crop_code,
              regionCode: region_code,
              targetDate,
              config,
            }),
          );
        } catch (error) {
          return json(asToolError(error));
        }
      },
    );

    // --------------------------------------------------------
    server.tool(
      "get_agronomic_advice",
      "Get agronomic advice for a specific crop issue via hybrid search. " +
        "issue examples: rust_disease, nitrogen_deficiency, irrigation_scheduling. " +
        "Returns evidence-based recommendations drawn from the knowledge base.",
      {
        crop_code: z.string(),
        issue: z.string(),
      },
      async ({ crop_code, issue }) => {
        const config = await loadAppConfig();
        const query = issue.replace(/_/g, " ").trim();

        let scope = "crop_specific";
        let { results } = await container.searchService.search({
          query,
          config: config.azureOpenAI,
          cropCode: crop_code,
          topK: 3,
          mode: "hybrid",
        });

        // graceful fallback: no crop-specific article → return general
        // best-practice guidance instead of nothing (never fabricate)
        if (results.length === 0) {
          scope = "general";
          ({ results } = await container.searchService.search({
            query,
            config: config.azureOpenAI,
            cropCode: null,
            topK: 3,
            mode: "hybrid",
          }));
        }

        if (results.length === 0) {
          return json({
            crop_code,
            issue,
            scope,
            recommendations: [],
            message: "No matching agronomic knowledge found.",
          });
        }

        return json({
          crop_code,
          issue,
          scope,
          note:
            scope === "crop_specific"
              ? null
              : `No ${crop_code}-specific article found; returning general guidance.`,
          recommendations: results,
        });
      },
    );
  },
  {
    serverInfo: {
      name: "Agricultural Intelligence MCP Server",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 300,
    verboseLogs: false,
  },
);

/**
 * Every transport, behind the bearer token.
 *
 * Wrapping the handler rather than checking inside each tool: a tool
 * added later would otherwise be unguarded until someone remembered,
 * and "remembered" is not an access-control strategy.
 */
async function guarded(request: Request, context: unknown): Promise<Response> {
  try {
    requireMcpToken(request);
  } catch (error) {
    return toErrorResponse(error);
  }
  return (handler as (req: Request, ctx: unknown) => Promise<Response>)(
    request,
    context,
  );
}

export { guarded as GET, guarded as POST, guarded as DELETE };
