-- ============================================================================
-- Schema assertions for the Interesting Finds tables.
-- ============================================================================
-- Runs inside a transaction that always ROLLS BACK. Per DECISIONS D6 this
-- initiative commits no fixtures: the rows below exist for the length of one
-- transaction to prove an invariant holds, and are never persisted. Nothing
-- here may be copied into a migration or into supabase/seed.sql.
--
-- Run with: finds/db/test-schema.sh
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

-- --------------------------------------------------------------------------
-- finds_normalize_url: the cross-source dedupe key
-- --------------------------------------------------------------------------
DO $$
BEGIN
    -- scheme, www., trailing slash, default port, fragment and tracking params
    -- all collapse to the same key
    ASSERT finds_normalize_url('https://www.Acme.dev/')             = 'acme.dev';
    ASSERT finds_normalize_url('http://acme.dev')                   = 'acme.dev';
    ASSERT finds_normalize_url('https://acme.dev:443/?utm_source=x') = 'acme.dev';
    ASSERT finds_normalize_url('https://acme.dev/#features')        = 'acme.dev';

    -- a meaningful query parameter survives, and parameter order does not
    -- produce two keys for one URL
    ASSERT finds_normalize_url('https://acme.dev/App?id=42&utm_campaign=x')
         = finds_normalize_url('https://acme.dev/App?utm_campaign=x&id=42');
    ASSERT finds_normalize_url('https://acme.dev/App?id=42') = 'acme.dev/App?id=42';

    -- paths are case-sensitive even though hosts are not
    ASSERT finds_normalize_url('https://WWW.Acme.dev/Case/Path//') = 'acme.dev/Case/Path';

    -- unparseable input still dedupes against itself instead of returning NULL
    ASSERT finds_normalize_url('not a url') = 'not a url';
END $$;

-- --------------------------------------------------------------------------
-- One product seen on three platforms is one candidate
-- --------------------------------------------------------------------------
INSERT INTO finds_sources (slug, display_name, homepage_url, auth_kind) VALUES
    ('__test_peerlist', 'Peerlist', 'https://peerlist.io',          'session_cookie'),
    ('__test_hn',       'Show HN',  'https://news.ycombinator.com', 'public_api'),
    ('__test_ph',       'PH',       'https://producthunt.com',      'api_key');

DO $$
DECLARE
    spellings TEXT[] := ARRAY[
        'https://www.Acme.dev/?utm_source=peerlist',
        'http://acme.dev',
        'https://acme.dev/#hero'
    ];
    u TEXT;
    n INTEGER;
BEGIN
    FOREACH u IN ARRAY spellings LOOP
        INSERT INTO finds_candidates (product_url, name) VALUES (u, 'Acme')
        ON CONFLICT (canonical_url) DO UPDATE SET last_seen_at = NOW();
    END LOOP;

    SELECT count(*) INTO n FROM finds_candidates;
    ASSERT n = 1, format('three platforms produced %s candidate rows, expected 1', n);
END $$;

-- --------------------------------------------------------------------------
-- Re-running one source's pull inserts nothing new
-- --------------------------------------------------------------------------
DO $$
DECLARE
    n INTEGER;
BEGIN
    FOR i IN 1..2 LOOP
        INSERT INTO finds_candidate_sightings (candidate_id, source_id, external_id, source_url)
        SELECT c.id, s.id, 'launch-1', 'https://peerlist.io/p/launch-1'
          FROM finds_candidates c, finds_sources s
         WHERE s.slug = '__test_peerlist'
        ON CONFLICT (source_id, external_id) DO NOTHING;
    END LOOP;

    SELECT count(*) INTO n FROM finds_candidate_sightings;
    ASSERT n = 1, format('re-running a pull produced %s sightings, expected 1', n);
END $$;

-- --------------------------------------------------------------------------
-- DECISIONS D3: a source that cannot authenticate reports DOWN, not "quiet day"
-- --------------------------------------------------------------------------
UPDATE finds_sources SET last_success_at = NOW(),
                         credential_expires_at = NOW() - interval '1 day'
 WHERE slug = '__test_peerlist';
UPDATE finds_sources SET last_success_at = NOW()
 WHERE slug = '__test_hn';
UPDATE finds_sources SET last_success_at = NOW() - interval '5 days'
 WHERE slug = '__test_ph';

DO $$
DECLARE
    got TEXT;
BEGIN
    -- an expired cookie is DOWN even though the last pull succeeded
    SELECT status INTO got FROM finds_source_health WHERE slug = '__test_peerlist';
    ASSERT got = 'down', format('expired credential reported %s, expected down', got);

    SELECT status INTO got FROM finds_source_health WHERE slug = '__test_hn';
    ASSERT got = 'ok', format('healthy source reported %s, expected ok', got);

    -- nothing errored, but the cron has not landed a pull inside the budget
    SELECT status INTO got FROM finds_source_health WHERE slug = '__test_ph';
    ASSERT got = 'stale', format('stale source reported %s, expected stale', got);
END $$;

-- --------------------------------------------------------------------------
-- An error message with no timestamp cannot be ordered against last_success_at,
-- which is how a dead source gets misread as healthy. The CHECK refuses it.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        UPDATE finds_sources SET last_error = 'auth failed' WHERE slug = '__test_hn';
        RAISE EXCEPTION 'a half-written error record was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;  -- expected
    END;
END $$;

-- --------------------------------------------------------------------------
-- Evidence is immutable and append-only, for EVERY caller
-- --------------------------------------------------------------------------
-- RLS cannot enforce this: the pipeline writes with the service role, which
-- bypasses RLS entirely. So the ban has to be a trigger, and this asserts it
-- holds even for the table owner.
DO $$
DECLARE
    cand UUID;
    run  UUID := gen_random_uuid();
    ev   UUID;
BEGIN
    SELECT id INTO cand FROM finds_candidates LIMIT 1;

    INSERT INTO finds_evidence (candidate_id, crawl_run_id, url, page_role, http_status, quotes)
    VALUES (cand, run, 'https://acme.dev/pricing', 'pricing', 200,
            '[{"text": "Free forever for individuals", "locator": "h2"}]'::jsonb)
    RETURNING id INTO ev;

    BEGIN
        UPDATE finds_evidence SET http_status = 500 WHERE id = ev;
        RAISE EXCEPTION 'evidence was UPDATEable';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM finds_evidence WHERE id = ev;
        RAISE EXCEPTION 'evidence was DELETEable';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;
END $$;

-- --------------------------------------------------------------------------
-- DECISIONS D7: a score with no cited evidence cannot be committed
-- --------------------------------------------------------------------------
DO $$
DECLARE
    cand UUID;
    run  UUID;
BEGIN
    SELECT id INTO cand FROM finds_candidates LIMIT 1;
    SELECT crawl_run_id INTO run FROM finds_evidence LIMIT 1;

    -- The check is deferred to COMMIT, so a subtransaction is what proves it.
    BEGIN
        INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score, rationale, scored_by)
        VALUES (cand, run, 'C4', 3, 'feels agentic', 'test');
        -- force the deferred constraint to fire without ending the outer txn
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'an uncited score was accepted';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;
END $$;

-- A cited score commits fine, and citing another product's evidence does not.
DO $$
DECLARE
    cand  UUID;
    run   UUID;
    ev    UUID;
    other UUID;
    v     UUID;
BEGIN
    SELECT id INTO cand FROM finds_candidates LIMIT 1;
    SELECT id, crawl_run_id INTO ev, run FROM finds_evidence LIMIT 1;

    INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score, rationale, scored_by)
    VALUES (cand, run, 'C1', 3, 'pricing page states free tier; quoted', 'test')
    RETURNING id INTO v;
    INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id, stance)
    VALUES (v, ev, cand, 'supports');
    SET CONSTRAINTS ALL IMMEDIATE;

    -- a second product, with its own evidence
    INSERT INTO finds_candidates (product_url, name) VALUES ('https://other.dev', 'Other')
    RETURNING id INTO other;
    INSERT INTO finds_evidence (candidate_id, crawl_run_id, url, page_role)
    VALUES (other, gen_random_uuid(), 'https://other.dev', 'homepage');

    -- citing Acme's evidence for Other's verdict must be a FK violation
    BEGIN
        INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id)
        VALUES (v, (SELECT id FROM finds_evidence WHERE candidate_id = other), cand);
        RAISE EXCEPTION 'a verdict cited another product''s evidence';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    -- and stripping a live score's last citation must not be committable
    BEGIN
        DELETE FROM finds_verdict_evidence WHERE verdict_id = v;
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'a live score was stripped of its justification';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;
END $$;

-- --------------------------------------------------------------------------
-- finds_published: the ONLY table anon may read, and only when published
-- --------------------------------------------------------------------------
DO $$
DECLARE
    cand UUID;
    n    INTEGER;
BEGIN
    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;

    -- a published find with no evidence behind it is what D7 forbids
    BEGIN
        INSERT INTO finds_published (
            candidate_id, slug, name, product_url, source_labels, found_at,
            score_claim_verified, score_rare_problem, score_anyone_can_use,
            score_agentic_friendly, citations, published_at)
        VALUES (cand, 'acme', 'Acme', 'https://acme.dev', ARRAY['Peerlist'],
                NOW(), 3, 2, 3, 3, '[]'::jsonb, NOW());
        RAISE EXCEPTION 'a published find with no citations was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO finds_published (
        candidate_id, slug, name, product_url, source_labels, found_at,
        score_claim_verified, score_rare_problem, score_anyone_can_use,
        score_agentic_friendly, citations, published_at)
    VALUES (cand, 'acme', 'Acme', 'https://acme.dev',
            ARRAY['Peerlist', 'Show HN'], NOW(), 3, 2, 3, 3,
            '[{"criterion": "C1", "url": "https://acme.dev/pricing",
               "quote": "Free forever for individuals", "stance": "supports"}]'::jsonb,
            NOW());

    -- a draft: not published yet
    INSERT INTO finds_published (
        candidate_id, slug, name, product_url, source_labels, found_at,
        score_claim_verified, score_rare_problem, score_anyone_can_use,
        score_agentic_friendly, citations, published_at)
    SELECT id, 'other', 'Other', 'https://other.dev', ARRAY['Show HN'],
           NOW(), 1, 1, 1, 1,
           '[{"criterion": "C1", "url": "https://other.dev", "stance": "supports"}]'::jsonb,
           NULL
      FROM finds_candidates WHERE name = 'Other';

    -- the anon read path: RLS must hide the draft
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n FROM finds_published;
    ASSERT n = 1, format('anon sees %s published finds, expected 1 (the draft must be hidden)', n);
    RESET ROLE;

    -- anon may not write to the one table it can read
    SET LOCAL ROLE anon;
    BEGIN
        UPDATE finds_published SET name = 'defaced';
        ASSERT (SELECT count(*) FROM finds_published WHERE name = 'defaced') = 0,
               'anon updated a published find';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
END $$;

-- --------------------------------------------------------------------------
-- Digests: never the same find twice -- but a FAILED send must not burn one
-- --------------------------------------------------------------------------
DO $$
DECLARE
    cand UUID;
    d1   UUID;
    d2   UUID;
    d3   UUID;
    n    INTEGER;
BEGIN
    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;

    -- a send cannot claim delivery it did not get
    BEGIN
        INSERT INTO finds_digests (subject, recipient, status)
        VALUES ('Finds', 'nikhil@example.test', 'sent');
        RAISE EXCEPTION 'a digest claimed sent with no sent_at';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- ...and cannot fail silently
    BEGIN
        INSERT INTO finds_digests (subject, recipient, status)
        VALUES ('Finds', 'nikhil@example.test', 'failed');
        RAISE EXCEPTION 'a digest failed with no error recorded';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- digest 1 fails to send
    INSERT INTO finds_digests (subject, recipient) VALUES ('Finds', 'nikhil@example.test')
    RETURNING id INTO d1;
    INSERT INTO finds_digest_items (digest_id, candidate_id, position) VALUES (d1, cand, 0);
    UPDATE finds_digests SET status = 'failed', error = 'SMTP 535' WHERE id = d1;

    SELECT count(*) INTO n FROM finds_undigested_candidates WHERE id = cand;
    ASSERT n = 1, 'a failed send burned the candidate -- Nikhil never saw it';

    -- digest 2 carries the same candidate and succeeds
    INSERT INTO finds_digests (subject, recipient) VALUES ('Finds', 'nikhil@example.test')
    RETURNING id INTO d2;
    INSERT INTO finds_digest_items (digest_id, candidate_id, position) VALUES (d2, cand, 0);
    UPDATE finds_digests SET status = 'sent', sent_at = NOW() WHERE id = d2;

    SELECT count(*) INTO n FROM finds_undigested_candidates WHERE id = cand;
    ASSERT n = 0, 'a sent candidate is still offered for a future digest';

    -- and now it cannot be sent a second time
    INSERT INTO finds_digests (subject, recipient) VALUES ('Finds again', 'nikhil@example.test')
    RETURNING id INTO d3;
    INSERT INTO finds_digest_items (digest_id, candidate_id, position) VALUES (d3, cand, 0);
    BEGIN
        UPDATE finds_digests SET status = 'sent', sent_at = NOW() WHERE id = d3;
        RAISE EXCEPTION 'the same find was sent twice';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END $$;

ROLLBACK;

-- Proof that the transaction above left nothing behind.
DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT count(*) INTO n FROM finds_sources;
    ASSERT n = 0, format('%s source rows persisted -- the test must leave the schema empty', n);
    SELECT count(*) INTO n FROM finds_candidates;
    ASSERT n = 0, format('%s candidate rows persisted -- the test must leave the schema empty', n);
END $$;

\echo 'schema assertions passed'
