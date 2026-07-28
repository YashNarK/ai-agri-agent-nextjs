-- ============================================================
-- 05_knowledge_base.sql
-- RAG knowledge base tables: agronomic_knowledge, product_knowledge
-- These hold vector embeddings for semantic search and reference
-- crops, regions and products from earlier files.
-- ============================================================
SET search_path TO agricultural, public;

-- ============================================================
-- TABLE: agronomic_knowledge
-- the RAG knowledge base
-- stores agronomic documents, research papers, best practices
-- embedding column stores the vector embedding for semantic search
-- vector(1536) matches Azure OpenAI text-embedding-ada-002 dimensions
-- ============================================================
CREATE TABLE IF NOT EXISTS agronomic_knowledge (
    id              BIGSERIAL PRIMARY KEY,
    title           VARCHAR(500) NOT NULL,
    content         TEXT         NOT NULL,
    category        VARCHAR(100),           -- pest_management, soil_health, irrigation, etc.
    crop_id         INT          REFERENCES crops(id),
    region_id       INT          REFERENCES regions(id),
    source          VARCHAR(200),
    published_date  DATE,
    embedding       vector(1536),           -- Azure OpenAI embedding dimensions
    metadata        JSONB,                  -- flexible extra fields
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: product_knowledge
-- product documentation for RAG
-- product labels, usage guides, compatibility info
-- ============================================================
CREATE TABLE IF NOT EXISTS product_knowledge (
    id              BIGSERIAL PRIMARY KEY,
    product_id      INT          REFERENCES products(id),
    title           VARCHAR(500) NOT NULL,
    content         TEXT         NOT NULL,
    doc_type        VARCHAR(100),           -- label, sds, guide, faq
    embedding       vector(1536),
    metadata        JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
