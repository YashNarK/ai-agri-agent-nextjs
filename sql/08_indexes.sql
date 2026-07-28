-- ============================================================
-- 08_indexes.sql
-- INDEXES
-- Run last: all target tables must already exist.
-- indexes on all foreign keys and search columns
-- ============================================================
SET search_path TO agricultural, public;

-- crop price history — most queried by crop + region + date range
CREATE INDEX idx_price_history_crop_region_date
    ON crop_price_history (crop_id, region_id, price_date DESC);

-- weather data — queried by region + date range
CREATE INDEX idx_weather_region_date
    ON weather_data (region_id, weather_date DESC);

-- yield history — queried by crop + region + year
CREATE INDEX idx_yield_crop_region_year
    ON crop_yield_history (crop_id, region_id, harvest_year DESC);

-- market indicators — queried by name + date range
CREATE INDEX idx_market_indicators_name_date
    ON market_indicators (indicator_name, indicator_date DESC);

-- agronomic knowledge — vector similarity search index
-- ivfflat: inverted file index — approximate nearest neighbour
-- lists=100: number of clusters — tune based on data size
-- vector_cosine_ops: cosine similarity — standard for embeddings
CREATE INDEX idx_agronomic_knowledge_embedding
    ON agronomic_knowledge USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX idx_product_knowledge_embedding
    ON product_knowledge USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- agronomic knowledge — filter by category and crop
CREATE INDEX idx_agronomic_knowledge_category_crop
    ON agronomic_knowledge (category, crop_id);

-- chat messages — queried by session
CREATE INDEX idx_chat_messages_session
    ON chat_messages (session_id, created_at ASC);

-- price predictions — queried by crop + region + target date
CREATE INDEX idx_price_predictions_crop_region
    ON price_predictions (crop_id, region_id, target_date DESC);
