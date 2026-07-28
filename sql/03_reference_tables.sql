-- ============================================================
-- 03_reference_tables.sql
-- Master / reference data: regions, crops, products
-- These are the parent tables referenced by everything else,
-- so they must be created first.
-- ============================================================
SET search_path TO agricultural, public;

-- ============================================================
-- TABLE: regions
-- geographic regions where crops are grown and sold
-- ============================================================
CREATE TABLE IF NOT EXISTS regions (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(10)  NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    country     VARCHAR(100) NOT NULL,
    climate     VARCHAR(50),              -- tropical, temperate, arid, semi-arid
    latitude    DECIMAL(9,6),
    longitude   DECIMAL(9,6),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: crops
-- master list of all crops tracked in the system
-- ============================================================
CREATE TABLE IF NOT EXISTS crops (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(20)  NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL,
    category        VARCHAR(50)  NOT NULL,  -- cereal, oilseed, vegetable, fruit, legume
    sub_category    VARCHAR(50),
    scientific_name VARCHAR(150),
    growing_season  VARCHAR(50),            -- spring, summer, autumn, winter, year-round
    avg_yield_per_ha DECIMAL(10,2),         -- tonnes per hectare global average
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: products
-- crop protection and seed products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id              SERIAL PRIMARY KEY,
    sku             VARCHAR(50)   NOT NULL UNIQUE,
    name            VARCHAR(200)  NOT NULL,
    category        VARCHAR(50)   NOT NULL,  -- seed, herbicide, fungicide, insecticide, fertilizer
    sub_category    VARCHAR(50),
    crop_id         INT           REFERENCES crops(id),
    description     TEXT,
    active_ingredient VARCHAR(200),
    unit_of_measure VARCHAR(20)   NOT NULL,  -- kg, L, bag, unit
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
