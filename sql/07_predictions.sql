-- ============================================================
-- 07_predictions.sql
-- ML output table: price_predictions
-- references crops and regions from 03_reference_tables.sql.
-- ============================================================
SET search_path TO agricultural, public;

-- ============================================================
-- TABLE: price_predictions
-- stores ML model predictions for audit and analysis
-- ============================================================
CREATE TABLE IF NOT EXISTS price_predictions (
    id              BIGSERIAL PRIMARY KEY,
    crop_id         INT          NOT NULL REFERENCES crops(id),
    region_id       INT          NOT NULL REFERENCES regions(id),
    prediction_date TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    target_date     DATE         NOT NULL,
    predicted_price DECIMAL(10,2) NOT NULL,
    confidence_low  DECIMAL(10,2),
    confidence_high DECIMAL(10,2),
    model_version   VARCHAR(50),
    features_used   JSONB,                  -- what features the model used
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
