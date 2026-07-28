-- ============================================================
-- 04_timeseries_tables.sql
-- Time-series / ML feature tables:
--   crop_price_history (partitioned), weather_data,
--   crop_yield_history, market_indicators
-- These reference crops and regions from 03_reference_tables.sql.
-- ============================================================
SET search_path TO agricultural, public;

-- ============================================================
-- TABLE: crop_price_history
-- historical commodity prices per crop per region
-- this is the primary table for price prediction ML features
--
-- PARTITIONED BY RANGE on price_date for performance
-- large time-series tables benefit enormously from partitioning
-- queries filtered by date only scan relevant partitions
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_price_history (
    id              BIGSERIAL,
    crop_id         INT          NOT NULL REFERENCES crops(id),
    region_id       INT          NOT NULL REFERENCES regions(id),
    price_date      DATE         NOT NULL,
    price_usd_tonne DECIMAL(10,2) NOT NULL,  -- USD per metric tonne
    price_local     DECIMAL(10,2),           -- local currency per unit
    local_currency  VARCHAR(10),
    volume_traded   DECIMAL(15,2),           -- metric tonnes traded
    source          VARCHAR(100),            -- FAO, USDA, local exchange etc.
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, price_date)
) PARTITION BY RANGE (price_date);

-- create yearly partitions for price history
CREATE TABLE crop_price_history_2020 PARTITION OF crop_price_history
    FOR VALUES FROM ('2020-01-01') TO ('2021-01-01');
CREATE TABLE crop_price_history_2021 PARTITION OF crop_price_history
    FOR VALUES FROM ('2021-01-01') TO ('2022-01-01');
CREATE TABLE crop_price_history_2022 PARTITION OF crop_price_history
    FOR VALUES FROM ('2022-01-01') TO ('2023-01-01');
CREATE TABLE crop_price_history_2023 PARTITION OF crop_price_history
    FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE crop_price_history_2024 PARTITION OF crop_price_history
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE crop_price_history_2025 PARTITION OF crop_price_history
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- ============================================================
-- TABLE: weather_data
-- historical weather data per region per date
-- key features for price prediction ML model
-- weather directly impacts crop yield and therefore price
-- ============================================================
CREATE TABLE IF NOT EXISTS weather_data (
    id              BIGSERIAL PRIMARY KEY,
    region_id       INT          NOT NULL REFERENCES regions(id),
    weather_date    DATE         NOT NULL,
    temp_max_c      DECIMAL(5,2),
    temp_min_c      DECIMAL(5,2),
    temp_avg_c      DECIMAL(5,2),
    rainfall_mm     DECIMAL(8,2),
    humidity_pct    DECIMAL(5,2),
    wind_speed_kmh  DECIMAL(6,2),
    solar_radiation DECIMAL(8,2),  -- MJ/m2
    drought_index   DECIMAL(5,2),  -- Palmer Drought Severity Index
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (region_id, weather_date)
);

-- ============================================================
-- TABLE: crop_yield_history
-- historical yield data per crop per region per year
-- another key ML feature — yield affects supply affects price
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_yield_history (
    id              SERIAL PRIMARY KEY,
    crop_id         INT          NOT NULL REFERENCES crops(id),
    region_id       INT          NOT NULL REFERENCES regions(id),
    harvest_year    INT          NOT NULL,
    yield_tonnes_ha DECIMAL(10,4) NOT NULL,
    area_harvested_ha DECIMAL(15,2),
    total_production_tonnes DECIMAL(15,2),
    quality_grade   VARCHAR(10),            -- A, B, C grade
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (crop_id, region_id, harvest_year)
);

-- ============================================================
-- TABLE: market_indicators
-- macro economic indicators that influence crop prices
-- fuel prices, fertilizer costs, exchange rates etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS market_indicators (
    id              BIGSERIAL PRIMARY KEY,
    indicator_date  DATE         NOT NULL,
    indicator_name  VARCHAR(100) NOT NULL,
    indicator_value DECIMAL(15,4) NOT NULL,
    unit            VARCHAR(50),
    source          VARCHAR(100),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (indicator_date, indicator_name)
);
