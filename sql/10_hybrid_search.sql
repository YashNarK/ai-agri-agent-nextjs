-- ============================================================
-- 10_hybrid_search.sql
-- Lexical half of hybrid retrieval over the knowledge base.
--
-- WHY A KEYWORD INDEX AT ALL, GIVEN pgvector
--
-- Embeddings match on meaning, which is exactly what makes them lose
-- rare literal tokens. "NPK 20-20-20", "Puccinia triticina", a product
-- SKU or a crop code all collapse toward the generic agronomic
-- neighbourhood of the sentence they sit in, so the one article that
-- names the thing does not reliably outrank ten that discuss the topic.
-- Full-text search has the mirror-image failure: it cannot match
-- "yellowing lower leaves" to an article titled "nitrogen deficiency".
--
-- Neither is a better retriever. Run both and fuse the rankings
-- (repositories/knowledge.repository.ts).
--
-- A GENERATED column, not a trigger: the tsvector is a pure function of
-- title and content, so the database can maintain it itself. A trigger
-- would be a second place to forget.
--
-- Safe to re-run, like every file here.
-- ============================================================
SET search_path TO agricultural, public;

-- ============================================================
-- agronomic_knowledge.search_tsv
--
-- setweight marks title tokens 'A' and body tokens 'B'. ts_rank_cd then
-- counts a title hit for more than a body hit, which matters because a
-- title is a human's summary of the article and a body mention may be
-- an aside.
--
-- 'english' is passed as a literal regconfig rather than relying on
-- default_text_search_config — the two-argument form is IMMUTABLE,
-- which is what a generated column requires. It also pins the stemmer
-- so a server-level setting cannot silently change what is indexed.
-- ============================================================
ALTER TABLE agronomic_knowledge
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'B')
    ) STORED;

-- GIN over the tsvector: the index type for "which rows contain this
-- token", as opposed to ivfflat's "which rows are near this point".
CREATE INDEX IF NOT EXISTS idx_agronomic_knowledge_search_tsv
    ON agronomic_knowledge USING GIN (search_tsv);
