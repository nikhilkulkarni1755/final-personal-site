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
    cand    UUID;
    run     UUID := gen_random_uuid();
    ev      UUID;
    verdict UUID;
BEGIN
    SELECT id INTO cand FROM finds_candidates LIMIT 1;

    -- W4 may not record a fetch it was not permitted to make, so the evidence
    -- insert needs the ALLOW verdict that authorised it.
    INSERT INTO finds_crawl_verdicts (
        rubric_version, gate_version, candidate_id, url, authority,
        registrable_domain, allowed, reason_code, reason_detail,
        deciding_signal, expires_at)
    VALUES ('R2-permission-rubric/1.1', '1.0.0', cand, 'https://acme.dev/pricing',
            'https://acme.dev', 'acme.dev', true, 'robots_absent',
            'robots.txt returned 404', 'ROBOTS_TXT', NOW() + interval '6 hours')
    RETURNING id INTO verdict;

    INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url,
                                page_role, http_status, quotes)
    VALUES (cand, verdict, run, 'https://acme.dev/pricing', 'pricing', 200,
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
        INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score, rationale, scored_by, rubric_version)
        VALUES (cand, run, 'C4', 3, 'feels agentic', 'test', 'test/1');
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
    ov    UUID;
    v     UUID;
BEGIN
    SELECT id INTO cand FROM finds_candidates LIMIT 1;
    SELECT id, crawl_run_id INTO ev, run FROM finds_evidence LIMIT 1;

    INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score, rationale, scored_by, rubric_version)
    VALUES (cand, run, 'C1', 3, 'pricing page states free tier; quoted', 'test', 'test/1')
    RETURNING id INTO v;
    INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id,
                                        evidence_run_id, stance)
    VALUES (v, ev, cand, run, 'supports');
    SET CONSTRAINTS ALL IMMEDIATE;

    -- a second product, with its own evidence
    INSERT INTO finds_candidates (product_url, name) VALUES ('https://other.dev', 'Other')
    RETURNING id INTO other;
    INSERT INTO finds_crawl_verdicts (
        rubric_version, gate_version, candidate_id, url, authority,
        registrable_domain, allowed, reason_code, reason_detail,
        deciding_signal, expires_at)
    VALUES ('R2-permission-rubric/1.1', '1.0.0', other, 'https://other.dev',
            'https://other.dev', 'other.dev', true, 'robots_no_rules',
            'robots.txt parsed, zero applicable rules', 'ROBOTS_TXT',
            NOW() + interval '6 hours')
    RETURNING id INTO ov;

    INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url, page_role)
    VALUES (other, ov, gen_random_uuid(), 'https://other.dev', 'homepage');

    -- citing Acme's evidence for Other's verdict must be a FK violation
    BEGIN
        INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id,
                                            evidence_run_id)
        VALUES (v, (SELECT id FROM finds_evidence WHERE candidate_id = other), cand, run);
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

-- --------------------------------------------------------------------------
-- The permission gate, as a schema constraint rather than a convention
-- --------------------------------------------------------------------------
DO $$
DECLARE
    cand   UUID;
    denied UUID;
BEGIN
    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;

    -- R2 §6.1: `allowed` cannot disagree with `reason_code`
    BEGIN
        INSERT INTO finds_crawl_verdicts (
            rubric_version, gate_version, candidate_id, url, authority,
            registrable_domain, allowed, reason_code, reason_detail,
            deciding_signal, expires_at)
        VALUES ('R2-permission-rubric/1.1', '1.0.0', cand, 'https://acme.dev',
                'https://acme.dev', 'acme.dev', true, 'robots_disallow',
                'Disallow: /', 'ROBOTS_TXT', NOW() + interval '1 day');
        RAISE EXCEPTION 'a verdict claimed allowed with a denying reason_code';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- R2 §7: only a human decision is permanent
    BEGIN
        INSERT INTO finds_crawl_verdicts (
            rubric_version, gate_version, candidate_id, url, authority,
            registrable_domain, allowed, reason_code, reason_detail,
            deciding_signal, expires_at)
        VALUES ('R2-permission-rubric/1.1', '1.0.0', cand, 'https://acme.dev',
                'https://acme.dev', 'acme.dev', false, 'ai_block_inferred',
                'GPTBot, ClaudeBot, CCBot disallowed', 'AI_BLOCK_INFERENCE', NULL);
        RAISE EXCEPTION 'a non-manual verdict was allowed to never expire';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- a real DENY: the row that proves we behaved
    INSERT INTO finds_crawl_verdicts (
        rubric_version, gate_version, candidate_id, url, authority,
        registrable_domain, allowed, reason_code, reason_detail,
        deciding_signal, deciding_rule, deciding_group, precedence_rule, expires_at)
    VALUES ('R2-permission-rubric/1.1', '1.0.0', cand, 'https://acme.dev/docs',
            'https://acme.dev', 'acme.dev', false, 'ai_block_inferred',
            'No group for InterestingFindsBot; 3 known AI crawler tokens disallowed',
            'AI_BLOCK_INFERENCE', 'Disallow: /', 'GPTBot', 'P5',
            NOW() + interval '24 hours')
    RETURNING id INTO denied;

    -- R2 §6.3: never store a Cookie or Authorization header
    BEGIN
        INSERT INTO finds_crawl_evidence (
            verdict_id, url, request_user_agent, request_headers, fetched_at)
        VALUES (denied, 'https://acme.dev/robots.txt', 'InterestingFindsBot/1.0',
                '{"Cookie": "session=abc"}'::jsonb, NOW());
        RAISE EXCEPTION 'a Cookie header was stored';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- evidence of a fetch we were NOT allowed to make must be unrepresentable
    BEGIN
        INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id,
                                    url, page_role)
        VALUES (cand, denied, gen_random_uuid(), 'https://acme.dev/docs', 'docs');
        RAISE EXCEPTION 'a page was crawled under a DENY verdict';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    -- the decision itself is final; only revalidation may move
    BEGIN
        UPDATE finds_crawl_verdicts SET allowed = true, reason_code = 'robots_allow'
         WHERE id = denied;
        RAISE EXCEPTION 'a gate decision was rewritten';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;

    -- R2 §7: a 304 extends the verdict by a fresh TTL. That must still work.
    UPDATE finds_crawl_verdicts
       SET expires_at = NOW() + interval '24 hours', revalidated_at = NOW()
     WHERE id = denied;

    BEGIN
        DELETE FROM finds_crawl_verdicts WHERE id = denied;
        RAISE EXCEPTION 'a verdict row was deleted -- it is the audit trail';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;
END $$;

-- --------------------------------------------------------------------------
-- A citation may say "we looked and could not tell"
-- --------------------------------------------------------------------------
-- Score 1 means "no evidence either way". Without this stance the only way to
-- record a 1 was to mislabel its citations as supporting or contradicting,
-- which would make D7's audit trail lie in exactly the cases where nothing was
-- proven -- and 'contradicts' would accuse a real company of something their
-- own page does not show.
DO $$
DECLARE
    cand UUID;
    run  UUID;
    ev   UUID;
    v    UUID;
BEGIN
    SET CONSTRAINTS ALL DEFERRED;

    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;
    SELECT id, crawl_run_id INTO ev, run FROM finds_evidence WHERE candidate_id = cand LIMIT 1;

    INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score,
                                rationale, scored_by, rubric_version)
    VALUES (cand, run, 'C3', 1, 'docs never say whether an account is required',
            'test', 'test/1')
    RETURNING id INTO v;

    INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id,
                                        evidence_run_id, stance)
    VALUES (v, ev, cand, run, 'inconclusive');
    SET CONSTRAINTS ALL IMMEDIATE;

    -- and the enum is still closed
    BEGIN
        UPDATE finds_verdict_evidence SET stance = 'probably' WHERE verdict_id = v;
        RAISE EXCEPTION 'an arbitrary stance was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

-- --------------------------------------------------------------------------
-- A verdict records the rubric that produced it
-- --------------------------------------------------------------------------
DO $$
DECLARE
    cand UUID;
    run  UUID;
BEGIN
    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;
    SELECT crawl_run_id INTO run FROM finds_evidence WHERE candidate_id = cand LIMIT 1;

    BEGIN
        INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score,
                                    rationale, scored_by, rubric_version)
        VALUES (cand, run, 'C2', 2, 'niche', 'test', '   ');
        RAISE EXCEPTION 'a blank rubric_version was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

-- --------------------------------------------------------------------------
-- finds_write_verdict: the D7/D17 bridge
-- --------------------------------------------------------------------------
-- The point of these is that each call is ONE statement, which is what one
-- PostgREST request gives you. If the function needed a second statement to
-- satisfy the deferred trigger it would fail here exactly as the two-call
-- client sequence does.
DO $$
DECLARE
    cand    UUID;
    run     UUID;
    ev      UUID;
    other   UUID;
    other_e UUID;
    n       INTEGER;
    got     SMALLINT;
    stance  TEXT;
    rubric  TEXT;
BEGIN
    -- an earlier block left constraints IMMEDIATE; the deferred trigger is the
    -- whole point of these cases, so put them back.
    SET CONSTRAINTS ALL DEFERRED;

    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;
    SELECT id, crawl_run_id INTO ev, run FROM finds_evidence WHERE candidate_id = cand LIMIT 1;

    -- one statement writes four verdicts and their citations
    SELECT finds_write_verdict(cand, run, 'R2-scoring/1.1', jsonb_build_array(
        jsonb_build_object('criterion','C1','score',3,'rationale','quoted from pricing',
            'scored_by','test','citations', jsonb_build_array(
                jsonb_build_object('evidence_id', ev, 'stance','supports'))),
        jsonb_build_object('criterion','C2','score',2,'rationale','narrow audience',
            'scored_by','test','citations', jsonb_build_array(
                jsonb_build_object('evidence_id', ev, 'stance','supports'))),
        jsonb_build_object('criterion','C3','score',1,'rationale','could not tell',
            'scored_by','test','citations', jsonb_build_array(
                jsonb_build_object('evidence_id', ev, 'stance','inconclusive'))),
        -- stance omitted on purpose: the column default must apply
        jsonb_build_object('criterion','C4','score',0,'rationale','no API mentioned',
            'scored_by','test','citations', jsonb_build_array(
                jsonb_build_object('evidence_id', ev)))
    )) INTO n;
    ASSERT n = 4, format('finds_write_verdict wrote %s verdicts, expected 4', n);

    SET CONSTRAINTS ALL IMMEDIATE;

    SELECT count(*) INTO n FROM finds_verdicts
     WHERE candidate_id = cand AND rubric_version = 'R2-scoring/1.1';
    ASSERT n = 4, format('%s verdicts carry the rubric version, expected 4', n);

    SELECT ve.stance INTO stance FROM finds_verdict_evidence ve
      JOIN finds_verdicts vv ON vv.id = ve.verdict_id
     WHERE vv.criterion = 'C4' AND vv.candidate_id = cand;
    ASSERT stance = 'supports',
           format('a citation with no stance stored %s, expected the column default', stance);

    -- Re-scoring replaces both the score and its citations -- and note the
    -- constraints are IMMEDIATE right now, from the assertion above. The
    -- function must defer them itself, because its delete-then-insert leaves
    -- the verdict briefly uncited.
    SELECT finds_write_verdict(cand, run, 'R2-scoring/1.2', jsonb_build_array(
        jsonb_build_object('criterion','C1','score',0,'rationale','claim disproved',
            'scored_by','test','citations', jsonb_build_array(
                jsonb_build_object('evidence_id', ev, 'stance','contradicts')))
    )) INTO n;
    SET CONSTRAINTS ALL IMMEDIATE;

    SELECT score INTO got FROM finds_verdicts
     WHERE candidate_id = cand AND evidence_run_id = run AND criterion = 'C1';
    ASSERT got = 0, format('re-score left score at %s, expected 0', got);

    SELECT count(*) INTO n FROM finds_verdict_evidence ve
      JOIN finds_verdicts vv ON vv.id = ve.verdict_id
     WHERE vv.criterion = 'C1' AND vv.candidate_id = cand;
    ASSERT n = 1, format('re-score left %s citations on C1, expected 1', n);

    SELECT rubric_version INTO rubric FROM finds_verdicts
     WHERE candidate_id = cand AND evidence_run_id = run AND criterion = 'C1';
    ASSERT rubric = 'R2-scoring/1.2',
           format('re-score left rubric_version at %s, expected R2-scoring/1.2', rubric);
END $$;

-- The function refuses what the constraint refuses.
DO $$
DECLARE
    cand    UUID;
    run     UUID;
    other   UUID;
    other_e UUID;
    n       INTEGER;
BEGIN
    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;
    SELECT crawl_run_id INTO run FROM finds_evidence WHERE candidate_id = cand LIMIT 1;

    SET CONSTRAINTS ALL DEFERRED;

    -- an uncited score, named by criterion
    BEGIN
        SELECT finds_write_verdict(cand, run, 'R2-scoring/1.1', jsonb_build_array(
            jsonb_build_object('criterion','C2','score',3,'rationale','vibes',
                'scored_by','test','citations', '[]'::jsonb))) INTO n;
        RAISE EXCEPTION 'the RPC accepted an uncited score';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;

    -- a missing rubric version
    BEGIN
        SELECT finds_write_verdict(cand, run, '', jsonb_build_array(
            jsonb_build_object('criterion','C2','score',3,'rationale','x',
                'scored_by','test','citations', jsonb_build_array(
                    jsonb_build_object('evidence_id',
                        (SELECT id FROM finds_evidence WHERE candidate_id = cand LIMIT 1)))))) INTO n;
        RAISE EXCEPTION 'the RPC accepted a blank rubric version';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;

    -- another product's evidence, smuggled in via the payload. candidate_id is
    -- taken from the argument, so the composite FK still refuses it.
    SELECT id INTO other FROM finds_candidates WHERE name = 'Other';
    SELECT id INTO other_e FROM finds_evidence WHERE candidate_id = other LIMIT 1;
    BEGIN
        SELECT finds_write_verdict(cand, run, 'R2-scoring/1.1', jsonb_build_array(
            jsonb_build_object('criterion','C2','score',3,'rationale','x',
                'scored_by','test','citations', jsonb_build_array(
                    jsonb_build_object('evidence_id', other_e, 'stance','supports'))))) INTO n;
        RAISE EXCEPTION 'the RPC cited another product''s evidence';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
END $$;

-- --------------------------------------------------------------------------
-- A citation must come from the generation its verdict scored
-- --------------------------------------------------------------------------
-- Evidence is append-only, so several generations of the same page coexist.
-- Citing across them would reintroduce exactly the drift immutability buys:
-- a re-crawl that fixed a 404 would let a stale score keep citing the 404.
DO $$
DECLARE
    cand     UUID;
    old_run  UUID;
    new_run  UUID := gen_random_uuid();
    verdict  UUID;
    old_ev   UUID;
    new_ev   UUID;
    v        UUID;
    n        INTEGER;
BEGIN
    SET CONSTRAINTS ALL DEFERRED;

    SELECT id INTO cand FROM finds_candidates ORDER BY name LIMIT 1;
    SELECT id, crawl_run_id INTO old_ev, old_run
      FROM finds_evidence WHERE candidate_id = cand LIMIT 1;
    SELECT crawl_verdict_id INTO verdict FROM finds_evidence WHERE id = old_ev;

    -- a SECOND generation of the same page, as a re-crawl would produce
    INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url,
                                page_role, http_status)
    VALUES (cand, verdict, new_run, 'https://acme.dev/pricing', 'pricing', 200)
    RETURNING id INTO new_ev;

    -- a verdict that scored the NEW generation may not cite the OLD one
    INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score,
                                rationale, scored_by, rubric_version)
    VALUES (cand, new_run, 'C2', 3, 'scored against the fresh crawl', 'test', 'test/1')
    RETURNING id INTO v;

    BEGIN
        INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id,
                                            evidence_run_id, stance)
        VALUES (v, old_ev, cand, new_run, 'supports');
        RAISE EXCEPTION 'a score cited evidence from a generation it did not read';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    -- ...and claiming the old run on the citation does not smuggle it past the
    -- verdict side of the key either
    BEGIN
        INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id,
                                            evidence_run_id, stance)
        VALUES (v, old_ev, cand, old_run, 'supports');
        RAISE EXCEPTION 'a citation disagreed with its verdict about the generation';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    -- the honest citation, from the generation actually scored
    INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id,
                                        evidence_run_id, stance)
    VALUES (v, new_ev, cand, new_run, 'supports');
    SET CONSTRAINTS ALL IMMEDIATE;

    -- and the RPC pins the run from its argument, so a payload cannot cross it
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
        SELECT finds_write_verdict(cand, new_run, 'test/1', jsonb_build_array(
            jsonb_build_object('criterion','C3','score',2,'rationale','x',
                'scored_by','test','citations', jsonb_build_array(
                    jsonb_build_object('evidence_id', old_ev, 'stance','supports'))))) INTO n;
        RAISE EXCEPTION 'the RPC cited evidence from an unscored generation';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
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
