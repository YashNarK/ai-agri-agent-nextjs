-- ============================================================
-- 06_chat.sql
-- Conversation memory for the LangGraph agent:
--   chat_sessions, chat_messages
-- chat_messages references chat_sessions, so sessions come first.
-- ============================================================
SET search_path TO agricultural, public;

-- ============================================================
-- TABLE: chat_sessions
-- stores conversation history for LangGraph agent
-- enables multi-turn conversations with memory
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         VARCHAR(100),
    session_name    VARCHAR(200),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    metadata        JSONB
);

-- ============================================================
-- TABLE: chat_messages
-- individual messages within a chat session
-- stores full LangGraph state for resumability
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id              BIGSERIAL PRIMARY KEY,
    session_id      UUID         NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role            VARCHAR(20)  NOT NULL,  -- human, ai, tool, system
    content         TEXT         NOT NULL,
    tool_calls      JSONB,                  -- tool calls made by the agent
    tool_results    JSONB,                  -- results from tool calls
    langgraph_state JSONB,                  -- full LangGraph state snapshot
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
