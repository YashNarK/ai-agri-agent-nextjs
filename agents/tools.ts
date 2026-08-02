// ============================================================
// agents/tools.ts
//
// LangChain tools available to the LangGraph agent.
//
// Tools are built as closures at graph-build time so they carry the
// resolved AppConfig and the service container with them, instead of
// relying on per-request dependency injection (which FastAPI provided
// and route handlers do not).
//
// They deliberately return PROSE, not JSON — the model reads these
// strings directly. The MCP tools return structured JSON instead.
//
// Each tool ALSO returns a structured artifact via LangChain's
// `content_and_artifact` response format, so the chat UI can render a
// chart instead of parsing the prose back apart. The model's view is
// unaffected: it still receives only the content string, byte for byte
// what it received before. See agents/artifacts.ts.
//
// Port of agents/tools.py
// ============================================================

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import type {
  AvailabilityArtifact,
  ForecastArtifact,
  IndicatorsArtifact,
  KnowledgeArtifact,
  PriceHistoryArtifact,
  WeatherArtifact,
} from "@/agents/artifacts";
import type { AppConfig } from "@/lib/aws/app-config";
import { ApiError } from "@/lib/errors";
import { parseDateOnly, toDateString, toNumber, toNumberOrNull } from "@/lib/serialize";
import type { Container } from "@/lib/container";

const pad = (value: string, width: number) => value.padEnd(width);
const money = (value: number) => value.toFixed(2);

export function buildAgentTools(container: Container, config: AppConfig) {
  const {
    cropRepo,
    regionRepo,
    priceRepo,
    weatherRepo,
    marketIndicatorRepo,
    searchService,
    predictionsService,
  } = container;

  // ----------------------------------------------------------
  const listAvailableCrops = tool(
    async () => {
      const [crops, regions, pairs] = await Promise.all([
        cropRepo.listCodes(),
        regionRepo.listCodes(),
        priceRepo.findAvailablePairs(),
      ]);

      const lines: string[] = ["CROPS (code — name — category):"];
      for (const c of crops) {
        lines.push(`  ${pad(c.code, 10)} ${c.name} (${c.category})`);
      }

      lines.push("\nREGIONS (code — name — country):");
      for (const r of regions) {
        lines.push(`  ${pad(r.code, 10)} ${r.name} (${r.country})`);
      }

      lines.push(
        "\nPrice data available for (crop_code @ region_code — months, range):",
      );
      if (pairs.length > 0) {
        for (const p of pairs) {
          lines.push(
            `  ${p.crop_code} @ ${p.region_code} — ` +
              `${Number(p.months)} months, ${toDateString(p.start_date)}..${toDateString(p.end_date)}`,
          );
        }
      } else {
        lines.push("  (none)");
      }

      lines.push(
        "\nIMPORTANT: get_crop_price_history and predict_crop_price only " +
          "work for the (crop @ region) pairs listed above. For any crop or " +
          "region not listed as an available pair, state that no data exists " +
          "— never invent a price or forecast.",
      );

      const artifact: AvailabilityArtifact = {
        kind: "availability",
        crops: crops.map((c) => ({
          code: c.code,
          name: c.name,
          category: c.category,
        })),
        regions: regions.map((r) => ({
          code: r.code,
          name: r.name,
          country: r.country,
        })),
        pairs: pairs.map((p) => ({
          crop_code: p.crop_code,
          region_code: p.region_code,
          months: Number(p.months),
          start_date: toDateString(p.start_date),
          end_date: toDateString(p.end_date),
        })),
      };

      return [lines.join("\n"), artifact];
    },
    {
      name: "list_available_crops",
      responseFormat: "content_and_artifact",
      description:
        "List the crop codes, region codes, and — most importantly — the " +
        "exact (crop, region) pairs that actually have price history in the " +
        "database. ALWAYS call this first. Only pairs listed under " +
        '"Price data available for" can be used with get_crop_price_history ' +
        "or predict_crop_price; any other pair has NO data and MUST NOT be " +
        "guessed or fabricated.",
      schema: z.object({}),
    },
  );

  // ----------------------------------------------------------
  const searchAgronomicKnowledge = tool(
    async ({ query, crop_code }) => {
      // Hybrid, so a question naming an exact term — a pathogen, a
      // fertiliser ratio, a product — retrieves the article that names
      // it rather than the five that are merely about the topic.
      const { results, mode, degraded } = await searchService.search({
        query,
        config: config.azureOpenAI,
        cropCode: crop_code,
        topK: 5,
        mode: "hybrid",
      });

      if (results.length === 0) {
        return ["No relevant agronomic knowledge found for this query.", null];
      }

      // The relevance line stays in the prose the model reads. It is
      // how the model can tell a strong match from a weak one, which is
      // what stops it presenting rank-five filler with the same
      // confidence as a direct hit.
      const prose = results
        .map((row) => {
          const relevance =
            row.similarity === null
              ? `Matched by: keyword`
              : `Similarity: ${row.similarity.toFixed(2)} | Matched by: ${row.matched_by}`;
          return (
            `[${row.category || "General"}] ${row.title}\n` +
            `${row.content.slice(0, 500)}\n` +
            `Source: ${row.source || "Unknown"} | ${relevance}`
          );
        })
        .join("\n\n---\n\n");

      const artifact: KnowledgeArtifact = {
        kind: "knowledge",
        query,
        mode,
        degraded: degraded !== null,
        results: results.map((row) => ({
          title: row.title,
          category: row.category,
          source: row.source,
          similarity: row.similarity,
          matched_by: row.matched_by,
          excerpt: row.content.slice(0, 500),
        })),
      };

      return [prose, artifact];
    },
    {
      name: "search_agronomic_knowledge",
      responseFormat: "content_and_artifact",
      description:
        "Search the agronomic knowledge base for information about crop management, " +
        "pest control, disease management, soil health, irrigation and best practices. " +
        "Use this when the user asks how to grow crops, manage diseases or pests, " +
        "improve yields, or any agronomic best-practice question. " +
        "Matches both meaning and exact wording, so include any specific " +
        "terms the user used — a pathogen name, a fertiliser ratio, a " +
        "product — verbatim in the query rather than paraphrasing them. " +
        "Returns relevant knowledge articles ranked by relevance.",
      schema: z.object({
        query: z.string().describe("The agronomic question to search for"),
        crop_code: z
          .string()
          .nullish()
          .describe("Optional crop code to scope the search, e.g. MAIZE"),
      }),
    },
  );

  // ----------------------------------------------------------
  const getCropPriceHistory = tool(
    async ({ crop_code, region_code, months_back }) => {
      const monthsBack = months_back ?? 12;

      const crop = await cropRepo.findByCode(crop_code);
      if (!crop) {
        return [`Crop '${crop_code}' not found in the database.`, null];
      }

      const region = await regionRepo.findByCode(region_code);
      if (!region) {
        return [`Region '${region_code}' not found in the database.`, null];
      }

      const cutoff = new Date(Date.now() - monthsBack * 30 * 86_400_000);

      const prices = await priceRepo.findHistory({
        cropId: crop.id,
        regionId: region.id,
        dateFrom: cutoff,
        limit: monthsBack,
      });

      if (prices.length === 0) {
        return [
          `No price history found for ${crop_code} in ${region_code} ` +
            `over the last ${monthsBack} months.`,
          null,
        ];
      }

      const lines = [`Price history for ${crop.name} in ${region.name}:`];
      for (const p of prices) {
        const volume = toNumberOrNull(p.volume_traded);
        lines.push(
          `  ${toDateString(p.price_date)}  $${money(toNumber(p.price_usd_tonne))}/tonne` +
            (volume ? `  vol=${volume.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""),
        );
      }

      const latest = toNumber(prices[0].price_usd_tonne);
      const oldest = toNumber(prices[prices.length - 1].price_usd_tonne);
      const changePct = oldest ? ((latest - oldest) / oldest) * 100 : 0;

      lines.push(
        `\nLatest: $${money(latest)}  |  ${prices.length}-month change: ` +
          `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`,
      );

      const artifact: PriceHistoryArtifact = {
        kind: "price_history",
        crop: crop.name,
        region: region.name,
        crop_code,
        region_code,
        // the repository returns newest-first; a time axis wants the
        // opposite, so reverse once here rather than in every renderer
        points: [...prices].reverse().map((p) => ({
          price_date: toDateString(p.price_date),
          price_usd_tonne: toNumber(p.price_usd_tonne),
          volume_traded: toNumberOrNull(p.volume_traded),
        })),
        latest,
        change_pct: changePct,
      };

      return [lines.join("\n"), artifact];
    },
    {
      name: "get_crop_price_history",
      responseFormat: "content_and_artifact",
      description:
        "Retrieve historical commodity price data for a crop in a region. " +
        "Use this when the user asks about past prices, price trends, or history. " +
        "Call list_available_crops first to get valid codes and the pairs that " +
        "actually have data. Example pairs: MAIZE @ US-CORN, WHEAT-W @ US-CORN, " +
        "SORGHUM @ US-SOUTH, COTTON @ US-SOUTH, SUNFLOWER @ US-SOUTH, SOY @ BR-SOY. " +
        "months_back: how many months of history to retrieve (default 12). " +
        "Returns price data with dates and USD per tonne values.",
      schema: z.object({
        crop_code: z.string(),
        region_code: z.string(),
        months_back: z.number().int().min(1).max(120).nullish(),
      }),
    },
  );

  // ----------------------------------------------------------
  const predictCropPrice = tool(
    async ({ crop_code, region_code, target_date }) => {
      let targetDate: Date;
      try {
        targetDate = parseDateOnly(target_date);
      } catch {
        return [
          `Invalid target_date format '${target_date}'. Use YYYY-MM-DD.`,
          null,
        ];
      }

      const crop = await cropRepo.findByCode(crop_code);
      if (!crop) {
        return [`Crop '${crop_code}' not found.`, null];
      }

      const region = await regionRepo.findByCode(region_code);
      if (!region) {
        return [`Region '${region_code}' not found.`, null];
      }

      let plan;
      try {
        plan = await predictionsService.buildForecastPlan(
          crop_code,
          region_code,
          crop.id,
          region.id,
          targetDate,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return [
          `NO FORECAST AVAILABLE for ${crop_code} @ ${region_code}: ` +
            `${detail} Do NOT fabricate a value and do NOT substitute a ` +
            `nearer date's forecast — tell the user plainly that this target ` +
            `date cannot be forecast, and say why.`,
          null,
        ];
      }

      let prediction;
      try {
        const path = await predictionsService.scoreForecastPath(plan, config);
        prediction = path[path.length - 1];
      } catch (error) {
        const detail =
          error instanceof ApiError
            ? error.detail
            : error instanceof Error
              ? error.message
              : String(error);
        return [
          detail.startsWith("Price model error")
            ? detail
            : `Price model error: ${detail}`,
          null,
        ];
      }

      const { predictedPrice, confidenceLow, confidenceHigh } = prediction;
      const { last_history_date, months_extrapolated, history_months, method } =
        plan.provenance;

      // The horizon goes in the PROSE, not just the artifact, because the
      // prose is what the model reads. Without it, three forecasts past
      // the end of history look like three independent readings, and the
      // model narrates the resemblance between them as a market trend
      // rather than as the artefact of extrapolation it is.
      const horizonLine =
        months_extrapolated === 0
          ? `  Horizon         : within recorded history (last actual price ${last_history_date})`
          : `  Horizon         : ${months_extrapolated} month(s) BEYOND the last actual ` +
            `price (${last_history_date}), reached by rolling the model forward ` +
            `one month at a time`;

      const caveat =
        months_extrapolated >= 6
          ? `\nEXTRAPOLATION WARNING: this is ${months_extrapolated} months past the ` +
            `last observed price. Each step feeds the previous step's output back in, ` +
            `so confidence degrades with distance. State the horizon when you report ` +
            `this number, and do NOT describe it as a market trend, an equilibrium, ` +
            `or a stable price — it is one projection with compounding uncertainty.`
          : "";

      const prose =
        `Price prediction for ${crop.name} in ${region.name} on ${target_date}:\n` +
        `  Predicted price : $${money(predictedPrice)}/tonne\n` +
        `  Confidence low  : $${money(confidenceLow ?? predictedPrice)}/tonne\n` +
        `  Confidence high : $${money(confidenceHigh ?? predictedPrice)}/tonne\n` +
        horizonLine +
        `\n  Based on        : ${history_months} months of recorded history (${method} scoring)` +
        caveat;

      const artifact: ForecastArtifact = {
        kind: "forecast",
        crop: crop.name,
        region: region.name,
        crop_code,
        region_code,
        target_date,
        predicted_price: predictedPrice,
        // kept null rather than collapsed onto the point estimate the way
        // the prose does — a chart drawing a zero-width band would claim
        // certainty the model never reported
        confidence_low: confidenceLow ?? null,
        confidence_high: confidenceHigh ?? null,
        last_history_date,
        months_extrapolated,
      };

      return [prose, artifact];
    },
    {
      name: "predict_crop_price",
      responseFormat: "content_and_artifact",
      description:
        "Predict the future commodity price for a crop in a region via the ML price model. " +
        "Use this when the user asks about future prices, forecasts, or predictions. " +
        "target_date format: YYYY-MM-DD. " +
        "Requires existing price history for the crop/region pair — call " +
        "list_available_crops first and only forecast pairs listed there. " +
        "Valid pairs include: MAIZE @ US-CORN, WHEAT-W @ US-CORN, " +
        "SORGHUM @ US-SOUTH, COTTON @ US-SOUTH, SUNFLOWER @ US-SOUTH, SOY @ BR-SOY. " +
        "Returns predicted price with confidence interval.",
      schema: z.object({
        crop_code: z.string(),
        region_code: z.string(),
        target_date: z.string().describe("YYYY-MM-DD"),
      }),
    },
  );

  // ----------------------------------------------------------
  const getWeatherOutlook = tool(
    async ({ region_code }) => {
      const region = await regionRepo.findByCode(region_code);
      if (!region) {
        return [`Region '${region_code}' not found.`, null];
      }

      const records = await weatherRepo.findRecentByRegion(region.id, 3);
      if (records.length === 0) {
        return [`No weather data found for region ${region_code}.`, null];
      }

      const lines = [`Recent weather for ${region.name} (${region.country}):`];
      for (const w of records) {
        lines.push(
          `  ${toDateString(w.weather_date)}  ` +
            `avg=${toNumberOrNull(w.temp_avg_c)}°C  ` +
            `rain=${toNumberOrNull(w.rainfall_mm)}mm  ` +
            `drought_index=${toNumberOrNull(w.drought_index)}`,
        );
      }

      const artifact: WeatherArtifact = {
        kind: "weather",
        region: region.name,
        region_code,
        records: records.map((w) => ({
          weather_date: toDateString(w.weather_date),
          temp_avg_c: toNumberOrNull(w.temp_avg_c),
          rainfall_mm: toNumberOrNull(w.rainfall_mm),
          drought_index: toNumberOrNull(w.drought_index),
        })),
      };

      return [lines.join("\n"), artifact];
    },
    {
      name: "get_weather_outlook",
      responseFormat: "content_and_artifact",
      description:
        "Retrieve recent weather data and drought index for a region. " +
        "Use this when the user asks about weather conditions, drought risk, " +
        "or when weather context is needed to answer agronomic questions. " +
        "region_code examples: US-WHEAT, US-CORN, FR-WHEAT, IN-RICE, BR-SOY. " +
        "Returns temperature, rainfall and drought index data.",
      schema: z.object({ region_code: z.string() }),
    },
  );

  // ----------------------------------------------------------
  const getMarketIndicators = tool(
    async () => {
      const latest = await marketIndicatorRepo.findLatestPerIndicator();
      if (latest.length === 0) {
        return ["No market indicator data available.", null];
      }

      const lines = ["Current macro market indicators:"];
      for (const m of latest) {
        const value = toNumber(m.indicator_value).toFixed(2);
        lines.push(
          `  ${pad(m.indicator_name, 35)} ${value.padStart(10)} ` +
            `${m.unit ?? ""}  (as of ${toDateString(m.indicator_date)})`,
        );
      }

      const artifact: IndicatorsArtifact = {
        kind: "indicators",
        indicators: latest.map((m) => ({
          indicator_name: m.indicator_name,
          indicator_value: toNumber(m.indicator_value),
          unit: m.unit ?? null,
          indicator_date: toDateString(m.indicator_date),
        })),
      };

      return [lines.join("\n"), artifact];
    },
    {
      name: "get_market_indicators",
      responseFormat: "content_and_artifact",
      description:
        "Retrieve current macro market indicators including oil prices, " +
        "fertilizer costs and food price indices. " +
        "Use this when the user asks about market conditions, input costs, " +
        "or factors affecting crop prices globally. " +
        "Returns latest values for key agricultural market indicators.",
      schema: z.object({}),
    },
  );

  // ----------------------------------------------------------
  return [
    listAvailableCrops,
    searchAgronomicKnowledge,
    getCropPriceHistory,
    predictCropPrice,
    getWeatherOutlook,
    getMarketIndicators,
  ];
}

export type AgentTools = ReturnType<typeof buildAgentTools>;
