-- ============================================================================
-- Interesting Finds: crawl verdicts  (the permission-gate audit trail)
-- ============================================================================
-- Conforms to research/R2-permission-rubric.md v1.1 §6 and §6.3. W1 produces
-- these; W4 may not fetch a byte except through one.
--
-- This table answers exactly one question, asked by a stranger: "why did you
-- crawl me?" Reading one row must produce what we asked for, who we said we
-- were, what we read to decide, which line of their file decided it, when, and
-- under which version of the rubric. R2 §6.3 is explicit that a DENY produces a
-- row too -- those rows are the proof we behaved.
--
-- Three things the schema enforces rather than trusts:
--
--   1. `allowed` cannot disagree with `reason_code`. The enum splits cleanly
--      into ALLOW codes and DENY codes (R2 §6.1), so a row claiming it was
--      allowed for reason `robots_disallow` is not representable.
--   2. No Cookie or Authorization header is ever stored. R2 §6.3 says we never
--      send one and to assert it anyway; this is the assertion.
--   3. Evidence cannot exist for a page we were not allowed to fetch. The FK
--      added to finds_evidence at the bottom is composite on (verdict, allowed)
--      so recording a crawl of a denied URL is a foreign-key violation. "W4 may
--      not fetch except through the gate" stops being a convention.
--
-- Verdicts are APPEND-ONLY apart from revalidation. R2 §6.3: never delete a
-- verdict row. R2 §7: a 304 extends an existing verdict by a fresh TTL. So
-- DELETE and TRUNCATE are refused outright, and UPDATE may touch only
-- expires_at and revalidated_at -- the decision itself never changes.
--
-- NO SEED ROWS (DECISIONS D6).
-- ============================================================================

-- ============================================================================
-- FUNCTION: finds_headers_are_safe
-- ============================================================================
-- R2 §6.3: never store a Cookie or Authorization header. A CHECK cannot hold a
-- subquery, but it may call a function that does.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_headers_are_safe(headers JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT jsonb_typeof(headers) = 'object'
       AND NOT EXISTS (
            SELECT 1
              FROM jsonb_object_keys(headers) AS k
             WHERE lower(k) IN ('cookie', 'set-cookie',
                                'authorization', 'proxy-authorization')
       );
$$;

COMMENT ON FUNCTION finds_headers_are_safe(JSONB) IS 'R2 §6.3: refuses a header bag containing Cookie or Authorization. We never send one; this asserts it';

-- ============================================================================
-- TABLE: finds_crawl_verdicts
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_crawl_verdicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which rules produced this. A verdict is only interpretable against the
    -- rubric revision that decided it.
    rubric_version TEXT NOT NULL,
    gate_version TEXT NOT NULL,

    candidate_id UUID NOT NULL REFERENCES finds_candidates(id) ON DELETE RESTRICT,

    -- Exactly what was asked about, and the cache key (R2 §7: the authority,
    -- scheme://host[:port] -- NOT the registrable domain).
    url TEXT NOT NULL,
    authority TEXT NOT NULL,
    registrable_domain TEXT NOT NULL,

    -- ---- ACCESS ----
    allowed BOOLEAN NOT NULL,
    reason_code TEXT NOT NULL,
    reason_detail TEXT NOT NULL,
    deciding_signal TEXT NOT NULL,
    -- The literal line from their file, verbatim. This is the exhibit.
    deciding_rule TEXT,
    deciding_group TEXT,
    precedence_rule TEXT,

    -- ---- USE (meaningful only when allowed) ----
    use_rights JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- ---- what we will do if allowed ----
    crawl_budget JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- ---- robots.txt provenance (R2 §6) ----
    robots JSONB NOT NULL DEFAULT '{}'::jsonb,

    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL means never expires, which R2 §7 permits for exactly one code:
    -- manual_denylist, because a human decided and only a human undoes it.
    expires_at TIMESTAMPTZ,
    -- Set when a 304 extended this verdict (R2 §7). The only other mutable column.
    revalidated_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_crawl_verdicts_reason_code_check CHECK (reason_code IN (
        -- ALLOW (R2 §6.1)
        'robots_exact_group', 'robots_allow', 'robots_wildcard_allow',
        'robots_no_rules', 'robots_absent', 'robots_soft_404',
        'robots_redirect_loop',
        -- DENY (R2 §6.1)
        'manual_denylist', 'url_out_of_scope', 'robots_disallow',
        'robots_wildcard_disallow', 'ai_block_inferred', 'robots_forbidden',
        'robots_rate_limited', 'robots_server_error', 'robots_unreachable',
        'robots_bad_success', 'origin_blocked_us', 'origin_rate_limited',
        'bot_challenge', 'unhandled_case'
    )),

    CONSTRAINT finds_crawl_verdicts_deciding_signal_check CHECK (deciding_signal IN (
        'MANUAL_DENYLIST', 'URL_POLICY', 'ROBOTS_TXT', 'AI_BLOCK_INFERENCE',
        'HTTP_STATUS', 'BOT_CHALLENGE', 'RATE_LIMIT', 'CACHED_VERDICT', 'UNHANDLED'
    )),

    -- A verdict cannot claim it was allowed for a denying reason, or vice
    -- versa. R2 §6.1 splits the enum cleanly, so the schema can hold the split.
    CONSTRAINT finds_crawl_verdicts_allowed_matches_reason_check CHECK (
        allowed = (reason_code IN (
            'robots_exact_group', 'robots_allow', 'robots_wildcard_allow',
            'robots_no_rules', 'robots_absent', 'robots_soft_404',
            'robots_redirect_loop'
        ))
    ),

    -- R2 §7: "a verdict without a live expires_at is not a verdict". Only a
    -- human decision is permanent.
    CONSTRAINT finds_crawl_verdicts_expiry_check CHECK (
        (expires_at IS NULL) = (reason_code = 'manual_denylist')
    ),
    CONSTRAINT finds_crawl_verdicts_expiry_order_check CHECK (
        expires_at IS NULL OR expires_at > decided_at
    ),
    CONSTRAINT finds_crawl_verdicts_reason_detail_check CHECK (btrim(reason_detail) <> ''),
    CONSTRAINT finds_crawl_verdicts_url_check CHECK (btrim(url) <> ''),
    CONSTRAINT finds_crawl_verdicts_authority_check CHECK (btrim(authority) <> ''),

    -- Target for the composite FK from finds_evidence: lets a page's evidence
    -- prove by FK alone that its verdict was an ALLOW.
    CONSTRAINT finds_crawl_verdicts_id_allowed_key UNIQUE (id, allowed)
);

COMMENT ON TABLE finds_crawl_verdicts IS 'W1 permission-gate decision per URL, per R2-permission-rubric v1.1 §6. The answer to "why did you crawl me". A DENY produces a row too';
COMMENT ON COLUMN finds_crawl_verdicts.authority IS 'scheme://host[:port] -- the cache key per R2 §7. NOT the registrable domain';
COMMENT ON COLUMN finds_crawl_verdicts.reason_code IS 'Closed enum, R2 §6.1. Its ALLOW/DENY split is enforced against the allowed column';
COMMENT ON COLUMN finds_crawl_verdicts.deciding_rule IS 'The literal line from their robots.txt, verbatim. The primary exhibit';
COMMENT ON COLUMN finds_crawl_verdicts.use_rights IS 'R2 §3.2 USE decision. Never decides access; train is constant false';
COMMENT ON COLUMN finds_crawl_verdicts.expires_at IS 'NULL only for manual_denylist: a human decided and only a human undoes it';
COMMENT ON COLUMN finds_crawl_verdicts.revalidated_at IS 'Set when a 304 extended this verdict (R2 §7). With expires_at, the only mutable column';

-- R2 §6.3: this is the cache lookup on the hot path.
CREATE INDEX IF NOT EXISTS idx_finds_crawl_verdicts_authority_expiry
    ON finds_crawl_verdicts(authority, expires_at);
CREATE INDEX IF NOT EXISTS idx_finds_crawl_verdicts_candidate
    ON finds_crawl_verdicts(candidate_id, decided_at DESC);

-- ============================================================================
-- TABLE: finds_crawl_evidence
-- ============================================================================
-- Everything we fetched to reach the decision (R2 §6.3). The robots.txt body is
-- stored verbatim -- it is the primary exhibit, and at <=500 KiB with a sha256
-- it dedupes cheaply across the many URLs of one authority.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_crawl_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verdict_id UUID NOT NULL REFERENCES finds_crawl_verdicts(id) ON DELETE RESTRICT,

    url TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',

    -- Who we said we were. Half of answering "why did you crawl me".
    request_user_agent TEXT NOT NULL,
    request_headers JSONB NOT NULL DEFAULT '{}'::jsonb,

    http_status INTEGER,
    -- An allowlisted subset, never the whole bag (R2 §6).
    response_headers JSONB NOT NULL DEFAULT '{}'::jsonb,

    content_length INTEGER,
    sha256 TEXT,
    -- robots.txt: VERBATIM, up to 512000 bytes (R2 §6).
    body_excerpt TEXT,

    fetched_at TIMESTAMPTZ NOT NULL,
    elapsed_ms INTEGER,
    -- Text rather than INET: R2's own example is masked (104.21.x.x).
    remote_ip TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_crawl_evidence_url_check CHECK (btrim(url) <> ''),
    CONSTRAINT finds_crawl_evidence_ua_check CHECK (btrim(request_user_agent) <> ''),
    CONSTRAINT finds_crawl_evidence_status_check
        CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
    CONSTRAINT finds_crawl_evidence_body_size_check
        CHECK (body_excerpt IS NULL OR octet_length(body_excerpt) <= 512000),
    -- R2 §6.3: never store a Cookie or Authorization header.
    CONSTRAINT finds_crawl_evidence_request_headers_check
        CHECK (finds_headers_are_safe(request_headers)),
    CONSTRAINT finds_crawl_evidence_response_headers_check
        CHECK (finds_headers_are_safe(response_headers))
);

COMMENT ON TABLE finds_crawl_evidence IS 'Everything fetched to reach a gate decision (R2 §6.3). robots.txt bodies stored verbatim as the primary exhibit';
COMMENT ON COLUMN finds_crawl_evidence.request_user_agent IS 'Who we said we were. Half of answering "why did you crawl me"';
COMMENT ON COLUMN finds_crawl_evidence.body_excerpt IS 'robots.txt verbatim, capped at 512000 bytes per R2 §6';
COMMENT ON COLUMN finds_crawl_evidence.sha256 IS 'Dedupes one authority''s robots.txt across the many URLs decided from it';

CREATE INDEX IF NOT EXISTS idx_finds_crawl_evidence_verdict
    ON finds_crawl_evidence(verdict_id);
CREATE INDEX IF NOT EXISTS idx_finds_crawl_evidence_sha256
    ON finds_crawl_evidence(sha256) WHERE sha256 IS NOT NULL;

-- ============================================================================
-- APPEND-ONLY, EXCEPT REVALIDATION
-- ============================================================================
-- R2 §6.3: never delete a verdict row. R2 §7: a 304 extends an existing verdict
-- by a fresh TTL. So DELETE and TRUNCATE are refused outright, and UPDATE may
-- change only expires_at and revalidated_at. The decision never changes: a new
-- decision is a new row, which is what keeps the audit trail honest.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_crawl_verdict_decision_is_final()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    probe finds_crawl_verdicts := NEW;
BEGIN
    -- Neutralise the two columns revalidation is allowed to move, then require
    -- the rest of the row to be untouched. Comparing whole rows means a column
    -- added later is protected by default rather than by remembering to.
    probe.expires_at := OLD.expires_at;
    probe.revalidated_at := OLD.revalidated_at;

    IF probe IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION
            'a crawl verdict is final: only expires_at and revalidated_at may change (R2 §6.3, §7). Record a new decision as a new row'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION finds_crawl_verdict_decision_is_final() IS 'Permits the 304 revalidation of R2 §7 while keeping the decision itself immutable';

DROP TRIGGER IF EXISTS trigger_finds_crawl_verdicts_final ON finds_crawl_verdicts;
CREATE TRIGGER trigger_finds_crawl_verdicts_final
    BEFORE UPDATE ON finds_crawl_verdicts
    FOR EACH ROW
    EXECUTE FUNCTION finds_crawl_verdict_decision_is_final();

-- Reuses finds_reject_mutation() from the evidence migration.
DROP TRIGGER IF EXISTS trigger_finds_crawl_verdicts_no_delete ON finds_crawl_verdicts;
CREATE TRIGGER trigger_finds_crawl_verdicts_no_delete
    BEFORE DELETE ON finds_crawl_verdicts
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

DROP TRIGGER IF EXISTS trigger_finds_crawl_verdicts_no_truncate ON finds_crawl_verdicts;
CREATE TRIGGER trigger_finds_crawl_verdicts_no_truncate
    BEFORE TRUNCATE ON finds_crawl_verdicts
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

DROP TRIGGER IF EXISTS trigger_finds_crawl_evidence_append_only ON finds_crawl_evidence;
CREATE TRIGGER trigger_finds_crawl_evidence_append_only
    BEFORE UPDATE OR DELETE ON finds_crawl_evidence
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

DROP TRIGGER IF EXISTS trigger_finds_crawl_evidence_no_truncate ON finds_crawl_evidence;
CREATE TRIGGER trigger_finds_crawl_evidence_no_truncate
    BEFORE TRUNCATE ON finds_crawl_evidence
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

-- ============================================================================
-- THE GATE, MADE STRUCTURAL
-- ============================================================================
-- "W4 may not fetch a single page except through W1's gate" was a rule in
-- DEPENDENCIES.md that nothing enforced. Now every page-evidence row must name
-- the verdict that permitted it, and the FK is composite on (id, allowed) with
-- the child side pinned to true -- so evidence from a DENIED fetch is a
-- foreign-key violation, not a code review catch.
--
-- Safe as NOT NULL because the table is empty: this initiative ships no seed
-- rows (D6), so there is no historical evidence to backfill.
-- ============================================================================

ALTER TABLE finds_evidence
    ADD COLUMN IF NOT EXISTS crawl_verdict_id UUID NOT NULL,
    ADD COLUMN IF NOT EXISTS crawl_allowed BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE finds_evidence
    DROP CONSTRAINT IF EXISTS finds_evidence_crawl_allowed_check;
ALTER TABLE finds_evidence
    ADD CONSTRAINT finds_evidence_crawl_allowed_check CHECK (crawl_allowed);

ALTER TABLE finds_evidence
    DROP CONSTRAINT IF EXISTS finds_evidence_crawl_verdict_fkey;
ALTER TABLE finds_evidence
    ADD CONSTRAINT finds_evidence_crawl_verdict_fkey
    FOREIGN KEY (crawl_verdict_id, crawl_allowed)
    REFERENCES finds_crawl_verdicts(id, allowed) ON DELETE RESTRICT;

COMMENT ON COLUMN finds_evidence.crawl_verdict_id IS 'The gate decision that permitted this fetch. Composite FK on (id, allowed) makes evidence from a denied URL unrepresentable';
COMMENT ON COLUMN finds_evidence.crawl_allowed IS 'Pinned true by CHECK. Exists solely to make the FK to finds_crawl_verdicts(id, allowed) composite';

CREATE INDEX IF NOT EXISTS idx_finds_evidence_crawl_verdict
    ON finds_evidence(crawl_verdict_id);

-- ============================================================================
-- A candidate we were allowed to fetch but may not evaluate
-- ============================================================================
-- R2 §3.2: `llm_ingest=false` on the homepage means C1-C4 cannot be evaluated
-- at all. The candidate is dropped with reason ai_input_reserved, and per D6
-- that drop is recorded honestly -- it is a NON-EVALUATION, not a low score,
-- and inventing a verdict for it is exactly what D6 forbids. 'rejected' would
-- have said the wrong thing, so the work-queue enum gains a value that says the
-- right one.
-- ============================================================================

ALTER TABLE finds_candidates DROP CONSTRAINT IF EXISTS finds_candidates_status_check;
ALTER TABLE finds_candidates ADD CONSTRAINT finds_candidates_status_check CHECK (status IN (
    'new',
    'gate_blocked',    -- W1 said we may not fetch it
    'not_evaluable',   -- fetch allowed, but ai-input reserved (R2 §3.2)
    'crawled',
    'scored',
    'digested',
    'published',
    'rejected'
));

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Private. This is a record of other people's sites and our requests to them.
-- It is the answer we owe a site owner who asks, not something to publish.
-- ============================================================================

ALTER TABLE finds_crawl_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finds_crawl_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_crawl_verdicts" ON finds_crawl_verdicts;
CREATE POLICY "No public access to finds_crawl_verdicts"
    ON finds_crawl_verdicts FOR ALL
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS "No public access to finds_crawl_evidence" ON finds_crawl_evidence;
CREATE POLICY "No public access to finds_crawl_evidence"
    ON finds_crawl_evidence FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_crawl_verdicts FROM anon, authenticated;
REVOKE ALL ON finds_crawl_evidence FROM anon, authenticated;
