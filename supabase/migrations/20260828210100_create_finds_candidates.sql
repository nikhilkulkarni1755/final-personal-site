-- ============================================================================
-- Interesting Finds: candidates
-- ============================================================================
-- One row per PRODUCT we have seen launch, plus one sighting row per place we
-- saw it.
--
-- The problem this solves: the same product launches on Peerlist, Product Hunt
-- and Show HN within a day of each other. If each connector inserts its own
-- row we crawl the site three times, score it three times, and email Nikhil
-- the same find three times. So the dedupe key has to work ACROSS sources, and
-- the only thing the three listings genuinely share is the product's own URL.
--
-- URL normalisation is the hard part, and it is deliberately not left to the
-- connectors. `finds_normalize_url()` is IMMUTABLE and `canonical_url` is
-- GENERATED ALWAYS ... STORED, so the key is computed by the database on the
-- way in. A connector cannot forget to normalise, and two connectors cannot
-- disagree about what normalising means.
--
-- The sightings table is why the candidate stays one row without losing
-- anything: every platform listing keeps its own id, URL, author and verbatim
-- payload, so "this launched in three places" is still answerable.
--
-- NO SEED ROWS (DECISIONS D6).
-- ============================================================================

-- ============================================================================
-- FUNCTION: finds_normalize_url
-- ============================================================================
-- Reduces a product URL to the key we dedupe on. What it removes, and why:
--
--   fragment (#...)        never identifies a different product
--   scheme                 http and https are the same product
--   leading `www.`         www.acme.dev and acme.dev are the same product
--   default port           :80 / :443 are implied
--   host case              hosts are case-insensitive; paths are NOT, so the
--                          path keeps its case
--   trailing slash(es)     /pricing and /pricing/ are the same page
--   tracking parameters    utm_*, ref, fbclid, gclid and friends are how the
--                          same link arrives differently from three platforms
--
-- What it deliberately does NOT do: drop the whole query string. Some products
-- genuinely live behind a query parameter, and collapsing those would merge two
-- different products into one candidate. Surviving parameters are sorted so
-- ordering cannot produce two keys for one URL.
--
-- If the input does not parse as a URL we fall back to the trimmed, lowercased
-- input rather than returning NULL -- a bad URL should still dedupe against
-- itself instead of creating unbounded duplicates.
--
-- CAVEAT for whoever changes this function later: `canonical_url` is a STORED
-- generated column, so existing rows keep the OLD key until they are rewritten.
-- Any change to the rules needs a forward migration that also does
-- `ALTER TABLE finds_candidates ALTER COLUMN canonical_url ...` to force a
-- rebuild, and has to decide what to do with keys that now collide.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_normalize_url(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    WITH stripped AS (
        SELECT regexp_replace(
                   regexp_replace(btrim(raw), '#.*$', ''),
                   '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''
               ) AS rest
    ),
    split AS (
        SELECT split_part(rest, '?', 1) AS before_query,
               NULLIF(substring(rest from '\?(.*)$'), '') AS query_part
        FROM stripped
    ),
    hostpath AS (
        SELECT
            regexp_replace(
                regexp_replace(lower(split_part(before_query, '/', 1)), '^www\.', ''),
                ':(80|443)$', ''
            ) AS host,
            NULLIF(
                regexp_replace(
                    COALESCE(substring(before_query from '^[^/]*(/.*)$'), ''),
                    '/+$', ''
                ),
                ''
            ) AS path,
            query_part
        FROM split
    )
    SELECT CASE
        WHEN h.host = '' OR h.host IS NULL THEN lower(btrim(raw))
        ELSE h.host || COALESCE(h.path, '') || COALESCE('?' || q.query, '')
    END
    FROM hostpath h
    LEFT JOIN LATERAL (
        SELECT string_agg(kv, '&' ORDER BY kv) AS query
        FROM unnest(string_to_array(h.query_part, '&')) AS kv
        WHERE kv <> ''
          AND lower(split_part(kv, '=', 1)) NOT LIKE 'utm\_%'
          AND lower(split_part(kv, '=', 1)) NOT IN (
              'ref', 'ref_src', 'refsrc', 'referrer', 'source', 'src',
              'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
              'mc_cid', 'mc_eid', 'igshid', 'si', '_hsenc', '_hsmi'
          )
    ) q ON true;
$$;

COMMENT ON FUNCTION finds_normalize_url(TEXT) IS 'Cross-source dedupe key for a product URL: strips fragment, scheme, www., default port, trailing slash and tracking params; sorts surviving query params. IMMUTABLE so it can back a generated column';

-- ============================================================================
-- TABLE: finds_candidates
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The product's own website, exactly as the first source reported it.
    product_url TEXT NOT NULL,

    -- The dedupe key. Computed, not supplied.
    canonical_url TEXT GENERATED ALWAYS AS (finds_normalize_url(product_url)) STORED,

    name TEXT NOT NULL,
    tagline TEXT,

    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Work-queue marker, not a second copy of the truth. The authoritative
    -- record of what happened to a candidate is the rows in finds_crawl_verdicts,
    -- finds_evidence and finds_verdicts. This column exists so a cron run can
    -- find its next batch without four joins.
    status TEXT NOT NULL DEFAULT 'new',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_candidates_canonical_url_key UNIQUE (canonical_url),
    CONSTRAINT finds_candidates_product_url_check CHECK (btrim(product_url) <> ''),
    CONSTRAINT finds_candidates_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT finds_candidates_status_check CHECK (status IN (
        'new',          -- ingested, nothing decided yet
        'gate_blocked', -- the permission gate said we may not fetch it
        'crawled',      -- evidence collected
        'scored',       -- C1-C4 verdicts exist
        'digested',     -- included in an email
        'published',    -- Nikhil approved it and it is on the site
        'rejected'      -- Nikhil said no, or it scored out
    )),
    CONSTRAINT finds_candidates_seen_order_check CHECK (last_seen_at >= first_seen_at)
);

COMMENT ON TABLE finds_candidates IS 'One row per product launch, deduplicated across sources by normalised product URL';
COMMENT ON COLUMN finds_candidates.product_url IS 'The product website as first reported. Kept verbatim; never the dedupe key';
COMMENT ON COLUMN finds_candidates.canonical_url IS 'GENERATED dedupe key. Unique across all sources -- this is what stops us emailing one product three times';
COMMENT ON COLUMN finds_candidates.last_seen_at IS 'Bumped every time any source reports this product again';
COMMENT ON COLUMN finds_candidates.status IS 'Work-queue marker only. The other tables are the record of what actually happened';

CREATE INDEX IF NOT EXISTS idx_finds_candidates_status
    ON finds_candidates(status, first_seen_at DESC);

DROP TRIGGER IF EXISTS trigger_finds_candidates_updated_at ON finds_candidates;
CREATE TRIGGER trigger_finds_candidates_updated_at
    BEFORE UPDATE ON finds_candidates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TABLE: finds_candidate_sightings
-- ============================================================================
-- Every place we saw a candidate. Deduping to one candidate must not cost us
-- the provenance: a product that showed up on three platforms in one day is a
-- stronger signal than one that showed up on one, and if we ever comment back
-- (W9) we need the listing URL on the platform, not the product's homepage.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_candidate_sightings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES finds_candidates(id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: deleting a source must not silently erase the
    -- evidence of where a published find came from.
    source_id UUID NOT NULL REFERENCES finds_sources(id) ON DELETE RESTRICT,

    -- The source's own identifier for this listing. With source_id this is the
    -- per-source idempotency key: re-running today's pull inserts nothing new.
    external_id TEXT NOT NULL,

    -- The listing page ON the platform (not the product site). W9 comments here.
    source_url TEXT NOT NULL,

    title TEXT,
    author_handle TEXT,
    posted_at TIMESTAMPTZ,

    -- The source's response for this item, verbatim. Lets us re-derive fields
    -- later without re-fetching, and makes a connector bug auditable.
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,

    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_candidate_sightings_external_key UNIQUE (source_id, external_id),
    CONSTRAINT finds_candidate_sightings_external_id_check CHECK (btrim(external_id) <> '')
);

COMMENT ON TABLE finds_candidate_sightings IS 'One row per (source, listing): where each candidate was seen, kept so cross-source dedupe does not destroy provenance';
COMMENT ON COLUMN finds_candidate_sightings.external_id IS 'The platform''s own id. UNIQUE with source_id, so re-running a pull is idempotent';
COMMENT ON COLUMN finds_candidate_sightings.source_url IS 'The listing page on the platform. This is what W9 comments on, not the product site';
COMMENT ON COLUMN finds_candidate_sightings.raw IS 'Verbatim source payload for this item. Never edited';

CREATE INDEX IF NOT EXISTS idx_finds_candidate_sightings_candidate
    ON finds_candidate_sightings(candidate_id);
CREATE INDEX IF NOT EXISTS idx_finds_candidate_sightings_source_seen
    ON finds_candidate_sightings(source_id, seen_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Both tables are PRIVATE. A raw candidate is something we noticed, not
-- something Nikhil endorsed; publishing the backlog would leak the editorial
-- pipeline. Only finds_published is ever anon-readable.
-- ============================================================================

ALTER TABLE finds_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE finds_candidate_sightings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_candidates" ON finds_candidates;
CREATE POLICY "No public access to finds_candidates"
    ON finds_candidates FOR ALL
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS "No public access to finds_candidate_sightings" ON finds_candidate_sightings;
CREATE POLICY "No public access to finds_candidate_sightings"
    ON finds_candidate_sightings FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_candidates FROM anon, authenticated;
REVOKE ALL ON finds_candidate_sightings FROM anon, authenticated;
