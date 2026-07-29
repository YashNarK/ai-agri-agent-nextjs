// ============================================================
// lib/container.ts
//
// Composition root — the single place repositories are wired into
// services. FastAPI did this per request via Depends(); route
// handlers import the already-wired singletons from here instead.
//
// Everything is stateless (the Prisma client is resolved lazily per
// call), so module-level construction is safe and survives HMR.
// ============================================================

import { ChatRepository } from "@/repositories/chat.repository";
import { CropRepository } from "@/repositories/crop.repository";
import { KnowledgeRepository } from "@/repositories/knowledge.repository";
import { MarketIndicatorRepository } from "@/repositories/market-indicator.repository";
import { PredictionRepository } from "@/repositories/prediction.repository";
import { PriceRepository } from "@/repositories/price.repository";
import { ProductRepository } from "@/repositories/product.repository";
import { RegionRepository } from "@/repositories/region.repository";
import { WeatherRepository } from "@/repositories/weather.repository";
import { YieldRepository } from "@/repositories/yield.repository";

import { ChatService } from "@/services/chat.service";
import { CropsService } from "@/services/crops.service";
import { IndicatorsService } from "@/services/indicators.service";
import { PredictionsService } from "@/services/predictions.service";
import { PricesService } from "@/services/prices.service";
import { ProductsService } from "@/services/products.service";
import { RegionsService } from "@/services/regions.service";
import { SearchService } from "@/services/search.service";
import { WeatherService } from "@/services/weather.service";
import { YieldsService } from "@/services/yields.service";

// ── repositories ───────────────────────────────────────────────
const cropRepo = new CropRepository();
const regionRepo = new RegionRepository();
const priceRepo = new PriceRepository();
const productRepo = new ProductRepository();
const knowledgeRepo = new KnowledgeRepository();
const marketIndicatorRepo = new MarketIndicatorRepository();
const predictionRepo = new PredictionRepository();
const weatherRepo = new WeatherRepository();
const yieldRepo = new YieldRepository();
const chatRepo = new ChatRepository();

// ── services ───────────────────────────────────────────────────
const cropsService = new CropsService(cropRepo);
const regionsService = new RegionsService(regionRepo);
const pricesService = new PricesService(priceRepo, cropsService, regionsService);
const searchService = new SearchService(knowledgeRepo);
const predictionsService = new PredictionsService(
  priceRepo,
  marketIndicatorRepo,
  predictionRepo,
  cropsService,
  regionsService,
);
const chatService = new ChatService(chatRepo);
const weatherService = new WeatherService(weatherRepo, regionsService);
const yieldsService = new YieldsService(yieldRepo, cropsService, regionsService);
const indicatorsService = new IndicatorsService(marketIndicatorRepo);
const productsService = new ProductsService(productRepo, cropsService);

export const container = {
  cropRepo,
  regionRepo,
  priceRepo,
  productRepo,
  knowledgeRepo,
  marketIndicatorRepo,
  predictionRepo,
  weatherRepo,
  yieldRepo,
  chatRepo,
  cropsService,
  regionsService,
  pricesService,
  searchService,
  predictionsService,
  chatService,
  weatherService,
  yieldsService,
  indicatorsService,
  productsService,
};

export type Container = typeof container;

export {
  cropsService,
  regionsService,
  pricesService,
  searchService,
  predictionsService,
  chatService,
  weatherService,
  yieldsService,
  indicatorsService,
  productsService,
};
