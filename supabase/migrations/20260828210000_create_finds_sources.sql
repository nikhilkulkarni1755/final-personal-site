-- ============================================================================
-- Interesting Finds: sources
-- ============================================================================
-- The platforms we ingest product launches from (Peerlist, Show HN, Product
-- Hunt, ...) plus the per-source health record that lets the pipeline report a
-- source as DOWN honestly instead of reporting "no launches today".
--
-- Why the health columns are here and not derived from a log table:
-- DECISIONS D3 records that Peerlist access rides on Nikhil's own session
-- cookies, which expire around 2026-09-27 and die silently if he logs out or
-- rotates his password. A source that cannot authenticate must not be
-- indistinguishable from a source that genuinely had a quiet day. So every
-- attempt writes its outcome here, and `finds_source_health` turns that into a
-- status the digest can state out loud.
--
-- Naming: every table in this initiative is prefixed `finds_`. The `public`
-- schema is shared with the site analytics and two unrelated demos, and
-- unprefixed `sources` / `evidence` / `verdicts` would be a collision waiting
-- to happen.
--
-- NO SEED ROWS. Per DECISIONS D6 this table ships empty; sources are
-- registered by the ingest lane against credentials that actually exist.
-- ============================================================================

-- ============================================================================
-- TABLE: finds_sources
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    homepage_url TEXT NOT NULL,

    -- Operational posture
    enabled BOOLEAN NOT NULL DEFAULT true,
    auth_kind TEXT NOT NULL DEFAULT 'none',

    -- When the credential behind auth_kind stops working. NULL means either
    -- "no credential" or "expiry unknown" -- it is not a promise of validity.
    credential_expires_at TIMESTAMPTZ,

    -- Health. Written by the ingest lane after every pull attempt.
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    last_error_at TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,

    -- How stale a successful pull may get before the source counts as STALE.
    staleness_budget_hours INTEGER NOT NULL DEFAULT 36,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_sources_auth_kind_check
        CHECK (auth_kind IN ('none', 'public_api', 'api_key', 'oauth', 'session_cookie')),
    CONSTRAINT finds_sources_consecutive_failures_check
        CHECK (consecutive_failures >= 0),
    CONSTRAINT finds_sources_staleness_budget_check
        CHECK (staleness_budget_hours > 0),
    -- An error record is either complete or absent. A message with no timestamp
    -- cannot be compared against last_success_at, which is how a dead source
    -- gets misread as healthy.
    CONSTRAINT finds_sources_error_pair_check
        CHECK ((last_error IS NULL) = (last_error_at IS NULL))
);

COMMENT ON TABLE finds_sources IS 'Launch platforms we ingest from, with the health record behind honest DOWN reporting (DECISIONS D3)';
COMMENT ON COLUMN finds_sources.slug IS 'Stable machine key used by the connector code: peerlist, hn, producthunt';
COMMENT ON COLUMN finds_sources.auth_kind IS 'How we authenticate. session_cookie is credential-replay and is expected to expire';
COMMENT ON COLUMN finds_sources.credential_expires_at IS 'Known expiry of the credential. NULL means unknown, never means valid';
COMMENT ON COLUMN finds_sources.last_attempt_at IS 'Last time a pull was attempted, successful or not';
COMMENT ON COLUMN finds_sources.last_success_at IS 'Last time a pull completed and returned a usable response';
COMMENT ON COLUMN finds_sources.last_error IS 'Verbatim failure reason from the last failed attempt. Never a credential';
COMMENT ON COLUMN finds_sources.consecutive_failures IS 'Reset to 0 on success. Drives the DOWN threshold';
COMMENT ON COLUMN finds_sources.staleness_budget_hours IS 'A source with no success inside this window is STALE even if nothing errored';

CREATE INDEX IF NOT EXISTS idx_finds_sources_enabled
    ON finds_sources(enabled) WHERE enabled;

-- Reuses update_updated_at_column() from the marketplace migration.
DROP TRIGGER IF EXISTS trigger_finds_sources_updated_at ON finds_sources;
CREATE TRIGGER trigger_finds_sources_updated_at
    BEFORE UPDATE ON finds_sources
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEW: finds_source_health
-- ============================================================================
-- The D3 deliverable: one honest status per source, computed rather than
-- stored, so it cannot go stale relative to the clock.
--
--   disabled  -- switched off deliberately
--   down      -- credential expired, or the last attempt failed, or repeated
--                failures. We know this source is not working.
--   stale     -- nothing failed, but no successful pull inside the budget.
--                Usually means the cron did not run.
--   ok        -- pulled successfully inside the budget.
--
-- security_invoker = true is not optional. A view created the default way runs
-- with its owner's rights and reads straight past the RLS on finds_sources,
-- which would publish credential expiry dates to any anonymous visitor. That
-- is the same class of mistake 20251218000000 exists to fix.
-- ============================================================================

CREATE OR REPLACE VIEW finds_source_health
WITH (security_invoker = true) AS
SELECT
    s.id,
    s.slug,
    s.display_name,
    CASE
        WHEN NOT s.enabled THEN 'disabled'
        WHEN s.credential_expires_at IS NOT NULL
             AND s.credential_expires_at <= NOW() THEN 'down'
        WHEN s.last_error_at IS NOT NULL
             AND (s.last_success_at IS NULL OR s.last_error_at > s.last_success_at) THEN 'down'
        WHEN s.consecutive_failures >= 3 THEN 'down'
        WHEN s.last_success_at IS NULL THEN 'stale'
        WHEN s.last_success_at < NOW() - make_interval(hours => s.staleness_budget_hours) THEN 'stale'
        ELSE 'ok'
    END AS status,
    s.last_success_at,
    s.last_attempt_at,
    s.last_error,
    s.last_error_at,
    s.consecutive_failures,
    s.credential_expires_at
FROM finds_sources s;

COMMENT ON VIEW finds_source_health IS 'Computed per-source status (ok/stale/down/disabled) so the digest can say a source is broken instead of saying it found nothing (DECISIONS D3)';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- finds_sources is PRIVATE. It carries credential expiry and verbatim auth
-- errors, and the browser holds only the anon key.
--
-- The posture is: RLS on, and no permissive policy for anon. In Postgres that
-- already denies everything, but 20251218000000 established that this schema
-- writes its denials down rather than leaving them implied, so the explicit
-- FOR ALL ... USING (false) policy below is the readable form of the rule.
-- The service role bypasses RLS entirely; that is the pipeline's write path.
--
-- The REVOKE is the second lock. Supabase grants table privileges to anon by
-- default, so RLS is the only thing standing between the anon key and this
-- table. If a future migration ever attaches a permissive policy by accident,
-- the missing grant still refuses.
-- ============================================================================

ALTER TABLE finds_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_sources" ON finds_sources;
CREATE POLICY "No public access to finds_sources"
    ON finds_sources FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_sources FROM anon, authenticated;
REVOKE ALL ON finds_source_health FROM anon, authenticated;
