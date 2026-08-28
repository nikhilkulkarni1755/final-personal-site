-- ============================================================================
-- Interesting Finds: finds_published  (THE ONLY PUBLIC TABLE)
-- ============================================================================
-- The finds Nikhil approved, rendered by W7 on nikhilkulkarni1755.com. Named
-- per DECISIONS D8: `published` is doing real work in the name, because this is
-- the one table that has passed his approval and left the private side.
--
-- Everything else in this initiative is private. The site is a Vite SPA holding
-- the Supabase ANON key, so anything anon can SELECT is published to the world
-- whether or not a page renders it. That is why this table is a SNAPSHOT rather
-- than a view over candidates, evidence and verdicts: a join would either leak
-- the private pipeline or need a security-definer view that quietly reads past
-- RLS, which is the failure 20251218000000 exists to fix. Publishing copies the
-- handful of fields the page shows, deliberately and in full view.
--
-- The snapshot is also the honest model editorially. A published find is what
-- Nikhil approved on the day he approved it. Re-crawling the product later must
-- not silently rewrite a page he put his name on.
--
-- Visibility is `published_at`: NULL or future means the row is not readable by
-- anon. That gives unpublish and scheduling without a status column.
--
-- NO SEED ROWS (DECISIONS D6). The table ships empty and W7 shows an honest
-- empty state until Nikhil approves something real.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_published (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- One published find per candidate. RESTRICT so the pipeline row backing a
    -- live public page cannot be deleted out from under it.
    candidate_id UUID NOT NULL UNIQUE REFERENCES finds_candidates(id) ON DELETE RESTRICT,

    -- The find's URL on the site: /interesting-finds/<slug>
    slug TEXT NOT NULL UNIQUE,

    name TEXT NOT NULL,
    tagline TEXT,
    product_url TEXT NOT NULL,

    -- Which platforms we saw it on. An array because a launch appearing on
    -- three platforms in a day is itself part of the story, and collapsing that
    -- to one label throws the interesting half away.
    source_labels TEXT[] NOT NULL,

    -- When the pipeline first saw the launch, and when Nikhil published it.
    found_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,

    -- The C1-C4 scores, copied from finds_verdicts at publish time. Same 0-3
    -- evidential-support scale. Named for what they mean rather than C1..C4 so
    -- the page's markup reads like the page.
    score_claim_verified   SMALLINT NOT NULL,  -- C1 what is advertised is true
    score_rare_problem     SMALLINT NOT NULL,  -- C2 solves a rare problem
    score_anyone_can_use   SMALLINT NOT NULL,  -- C3 usable by any person
    score_agentic_friendly SMALLINT NOT NULL,  -- C4 agentic / MCP friendly

    -- Why the scores are what they are, copied from the cited evidence at
    -- publish time. Non-empty is a CHECK: D7's rule that no score stands
    -- unjustified does not stop applying because the score went public.
    -- [{ "criterion": "C1", "url": "...", "quote": "...", "stance": "supports" }]
    citations JSONB NOT NULL,

    -- Nikhil's own words about the find, or NULL. Per DECISIONS D4 the system
    -- never authors prose in his name, and this is a page under his name, so
    -- nothing generated may be written here. The schema cannot check
    -- authorship; this comment is the contract.
    why_interesting TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_published_slug_check
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT finds_published_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT finds_published_product_url_check CHECK (btrim(product_url) <> ''),
    CONSTRAINT finds_published_source_labels_check
        CHECK (array_length(source_labels, 1) >= 1),
    CONSTRAINT finds_published_scores_check CHECK (
        score_claim_verified   BETWEEN 0 AND 3 AND
        score_rare_problem     BETWEEN 0 AND 3 AND
        score_anyone_can_use   BETWEEN 0 AND 3 AND
        score_agentic_friendly BETWEEN 0 AND 3
    ),
    -- A published find with no evidence behind it is exactly what D7 forbids.
    CONSTRAINT finds_published_citations_check
        CHECK (jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) >= 1)
);

COMMENT ON TABLE finds_published IS 'The only anon-readable table in this initiative: finds Nikhil approved, snapshotted at publish time (DECISIONS D8)';
COMMENT ON COLUMN finds_published.slug IS 'URL segment on the site: /interesting-finds/<slug>';
COMMENT ON COLUMN finds_published.source_labels IS 'Platforms the launch was seen on. An array because appearing on three at once is part of the story';
COMMENT ON COLUMN finds_published.published_at IS 'Visibility switch. NULL or future means anon cannot read the row; no status column needed';
COMMENT ON COLUMN finds_published.citations IS 'Public projection of the evidence behind the scores. Non-empty by CHECK -- going public does not suspend D7';
COMMENT ON COLUMN finds_published.why_interesting IS 'Nikhil''s own words only. Per D4 the system never authors prose in his name';

-- Ordering index for the page's only query: newest published first.
CREATE INDEX IF NOT EXISTS idx_finds_published_visible
    ON finds_published(published_at DESC)
    WHERE published_at IS NOT NULL;

DROP TRIGGER IF EXISTS trigger_finds_published_updated_at ON finds_published;
CREATE TRIGGER trigger_finds_published_updated_at
    BEFORE UPDATE ON finds_published
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- The one place anon gets a SELECT. Unpublished and future-dated rows stay
-- invisible: the policy filters them, so a draft cannot be read by asking for
-- it directly with the anon key.
--
-- Writes are denied explicitly rather than by omission, in the style
-- 20251218000000 established. The service role bypasses RLS and publishes.
-- ============================================================================

ALTER TABLE finds_published ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published finds" ON finds_published;
CREATE POLICY "Public read published finds"
    ON finds_published FOR SELECT
    USING (published_at IS NOT NULL AND published_at <= NOW());

DROP POLICY IF EXISTS "Prevent public insert finds_published" ON finds_published;
CREATE POLICY "Prevent public insert finds_published"
    ON finds_published FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS "Prevent public update finds_published" ON finds_published;
CREATE POLICY "Prevent public update finds_published"
    ON finds_published FOR UPDATE
    USING (false);

DROP POLICY IF EXISTS "Prevent public delete finds_published" ON finds_published;
CREATE POLICY "Prevent public delete finds_published"
    ON finds_published FOR DELETE
    USING (false);

-- Supabase grants every privilege to anon by default. Narrow it to SELECT, so
-- the RLS policies above are a second lock rather than the only one.
REVOKE ALL ON finds_published FROM anon, authenticated;
GRANT SELECT ON finds_published TO anon, authenticated;
