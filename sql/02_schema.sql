-- ============================================================
-- 02_schema.sql
-- SCHEMA
-- all tables live in the agricultural schema
-- keeps our tables separate from any other schemas
-- ============================================================
CREATE SCHEMA IF NOT EXISTS agricultural;
SET search_path TO agricultural, public;
