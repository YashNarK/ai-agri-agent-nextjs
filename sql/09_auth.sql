-- ============================================================
-- 09_auth.sql
-- Identity and access: app_users
--
-- Authentication and authorisation are deliberately separate columns.
-- Proving who you are (GitHub OAuth, or a password for the admin) only
-- gets you a row here; `status` decides whether that row may spend
-- anything. Everyone lands as 'pending' until the admin approves them,
-- which is the whole point — the guarded surfaces call Azure OpenAI and
-- Azure ML, and those cost real money per request.
--
-- No Auth.js adapter tables. Sessions are JWTs (forced by the
-- credentials provider), so this one table is the entire user store.
-- ============================================================
SET search_path TO agricultural, public;

-- ============================================================
-- TABLE: app_users
-- one row per human who has ever signed in
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identity. Both are nullable and both are unique-when-present:
    -- GitHub accounts may hide their email, and the admin may sign in
    -- with a password before ever linking a GitHub account.
    email           VARCHAR(320),
    github_login    VARCHAR(100),

    name            VARCHAR(200),
    image           TEXT,

    -- Only ever populated for an admin, and NOT currently what
    -- authentication compares against: auth.ts checks the password
    -- against $ADMIN_PASSWORD_HASH, so admin identity lives in
    -- configuration rather than in a column anyone with database access
    -- could rewrite. This stores the same hash so a future multi-admin
    -- flow has somewhere to move to.
    password_hash   VARCHAR(255),

    role            VARCHAR(20)  NOT NULL DEFAULT 'user'
                    CHECK (role IN ('admin', 'user')),
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,
    -- Who approved them. No FK: an admin row may be deleted later and
    -- that must not cascade into rewriting the audit trail.
    approved_by     UUID
);

-- Partial unique indexes rather than plain UNIQUE constraints: NULLs are
-- distinct in Postgres, so a plain UNIQUE would happily accept many rows
-- with a NULL email, but these also keep the index small.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email
    ON app_users (LOWER(email)) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_github_login
    ON app_users (LOWER(github_login)) WHERE github_login IS NOT NULL;

-- The admin's pending-approval queue.
CREATE INDEX IF NOT EXISTS idx_app_users_status
    ON app_users (status, created_at DESC);
