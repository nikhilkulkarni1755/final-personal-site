-- ============================================================================
-- Interesting Finds: evidence
-- ============================================================================
-- What W4's crawler actually collected from a candidate's site. This is the
-- factual base the C1-C4 scores are computed from, and DECISIONS D7 says every
-- score has to cite it: "feels agentic" is not a score, and C1 ("what is
-- advertised is true") is a claims-vs-evidence diff and nothing less.
--
-- Evidence is IMMUTABLE and APPEND-ONLY. Verdicts get recomputed against
-- evidence, never the other way round, so a row that could be edited after a
-- score cited it would make the citation meaningless. RLS cannot enforce this
-- on its own -- the pipeline writes with the service role, which bypasses RLS
-- entirely -- so the ban is a trigger that refuses UPDATE, DELETE and TRUNCATE
-- for every caller including the service role. Re-crawling appends a new
-- generation of rows; it does not overwrite the old one.
--
-- The FK to finds_crawl_verdicts is added by the crawl-verdicts migration,
-- which is waiting on R2's permission rubric. Until then evidence stands on its
-- own; W1's gate decision still governs what W4 is allowed to fetch.
--
-- NO SEED ROWS (DECISIONS D6).
-- ============================================================================

-- ============================================================================
-- FUNCTION: finds_reject_mutation
-- ============================================================================
-- Shared by every append-only table in this initiative. Deliberately NOT
-- SECURITY DEFINER: it reads and writes nothing, it only refuses.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        '% is append-only: % is not permitted, including for the service role',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION finds_reject_mutation() IS 'Refuses UPDATE/DELETE/TRUNCATE on append-only audit tables. RLS cannot do this because the service role bypasses RLS';

-- ============================================================================
-- TABLE: finds_evidence
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- RESTRICT, not CASCADE: an audit trail that disappears when someone tidies
    -- up a candidate is not an audit trail.
    candidate_id UUID NOT NULL REFERENCES finds_candidates(id) ON DELETE RESTRICT,

    -- Groups the rows produced by one crawl pass. Because evidence is
    -- append-only, re-crawling a candidate leaves several generations in the
    -- table; without this there is no way to say "the evidence as of pass N",
    -- and a recomputed verdict could silently mix two passes.
    crawl_run_id UUID NOT NULL,

    url TEXT NOT NULL,
    page_role TEXT NOT NULL,

    -- What the fetch itself observed. A 404 on /docs is evidence too.
    http_status INTEGER,
    content_type TEXT,
    content_sha256 TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- What the page ASSERTS. The left-hand side of the C1 diff.
    -- [{ "text": "...", "locator": "..." }]
    claims JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Verbatim excerpts backing or contradicting a claim. Quoted, not
    -- paraphrased, so a score can be audited without re-fetching.
    -- [{ "text": "...", "locator": "..." }]
    quotes JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Measured behaviour rather than text: "GET /mcp returned 200",
    -- "openapi.json parsed", "signup required before any docs are visible".
    -- [{ "kind": "...", "detail": "...", "value": ... }]
    observations JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_evidence_url_check CHECK (btrim(url) <> ''),
    CONSTRAINT finds_evidence_page_role_check CHECK (page_role IN (
        'homepage', 'pricing', 'docs', 'api', 'mcp', 'changelog',
        'about', 'blog', 'repo', 'robots_txt', 'llms_txt', 'other'
    )),
    CONSTRAINT finds_evidence_http_status_check
        CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
    CONSTRAINT finds_evidence_claims_check CHECK (jsonb_typeof(claims) = 'array'),
    CONSTRAINT finds_evidence_quotes_check CHECK (jsonb_typeof(quotes) = 'array'),
    CONSTRAINT finds_evidence_observations_check CHECK (jsonb_typeof(observations) = 'array'),

    -- Lets a verdict citation prove, by FK alone, that it cites evidence for
    -- its OWN candidate. Used by the verdicts migration.
    CONSTRAINT finds_evidence_id_candidate_key UNIQUE (id, candidate_id)
);

COMMENT ON TABLE finds_evidence IS 'Immutable append-only record of what the crawler collected per candidate. The factual base every C1-C4 score must cite (DECISIONS D7)';
COMMENT ON COLUMN finds_evidence.crawl_run_id IS 'Groups one crawl pass. Re-crawling appends a new generation rather than overwriting';
COMMENT ON COLUMN finds_evidence.page_role IS 'What this page is to us, so scoring can ask for the pricing page without guessing from the URL';
COMMENT ON COLUMN finds_evidence.http_status IS 'Status actually returned. A 404 on /docs is evidence, not a missing row';
COMMENT ON COLUMN finds_evidence.content_sha256 IS 'Hash of the fetched body, so an unchanged page is recognisable across runs';
COMMENT ON COLUMN finds_evidence.claims IS 'What the page asserts: the left-hand side of the C1 claims-vs-evidence diff';
COMMENT ON COLUMN finds_evidence.quotes IS 'Verbatim excerpts. Quoted rather than paraphrased so a score can be audited without re-fetching';
COMMENT ON COLUMN finds_evidence.observations IS 'Measured behaviour rather than text (endpoint responded, schema parsed, signup wall hit)';

CREATE INDEX IF NOT EXISTS idx_finds_evidence_candidate
    ON finds_evidence(candidate_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_finds_evidence_run
    ON finds_evidence(crawl_run_id);

-- ============================================================================
-- IMMUTABILITY
-- ============================================================================
-- Statement-level, so it costs nothing on a bulk insert path and still refuses
-- the whole statement. TRUNCATE is covered separately because it is not a
-- DELETE and would otherwise walk straight through.
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_finds_evidence_append_only ON finds_evidence;
CREATE TRIGGER trigger_finds_evidence_append_only
    BEFORE UPDATE OR DELETE ON finds_evidence
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

DROP TRIGGER IF EXISTS trigger_finds_evidence_no_truncate ON finds_evidence;
CREATE TRIGGER trigger_finds_evidence_no_truncate
    BEFORE TRUNCATE ON finds_evidence
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Private. Crawl evidence is what we fetched from someone else's site; it is
-- not ours to republish. Anything a published find needs to show gets copied
-- into finds_published at approval time, deliberately and in full view.
-- ============================================================================

ALTER TABLE finds_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_evidence" ON finds_evidence;
CREATE POLICY "No public access to finds_evidence"
    ON finds_evidence FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_evidence FROM anon, authenticated;
