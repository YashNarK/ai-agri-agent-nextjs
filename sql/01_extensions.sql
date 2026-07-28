-- ============================================================
-- 01_extensions.sql
-- PostgreSQL Database Setup for Agricultural Intelligence Platform
--
-- SCHEMA DESIGN PHILOSOPHY:
--   normalized where it makes sense
--   denormalized for time-series price data (performance)
--   pgvector extension for semantic search embeddings
--   partitioning on price_history for query performance
--   indexes on all foreign keys and search columns
--
-- RUN ORDER: execute the numbered files in sequence (01 -> 08)
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- pgvector: stores and queries vector embeddings
--           enables semantic similarity search
--           used for RAG (Retrieval Augmented Generation)
-- uuid-ossp: generates UUIDs for primary keys
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
