#!/usr/bin/env bash
# Publish a find end to end against a real Postgres carrying the real
# migrations, then read it back the way the site does.
#
# WHAT THIS PROVES
#   * the REAL snapshot rules execute (Node's type stripping accepts them,
#     which `tsc --noEmit` does not establish -- see W8's finding) on rows that
#     came out of a real Postgres, not out of a fixture;
#   * the row they produce is accepted by the real finds_published table with
#     its real CHECKs;
#   * `published_at` IS the visibility switch: the same row is invisible to
#     anon while it is drafted, invisible while it is scheduled, visible once
#     the timestamp passes, and invisible again after an unpublish -- with RLS
#     on and the anon role really set, which is exactly what W7's useFinds gets;
#   * a re-crawled candidate is published from the generation it was last
#     SCORED on, score and quote together, never a mix of two;
#   * the DECISIONS D23 case is refused: a tenant on a shared host whose
#     evidence includes a page the host wrote never reaches the table at all.
#
# WHAT IT DOES NOT PROVE: db.ts's supabase-js binding. There is no PostgREST on
# this machine and no service-role key, so the transport is psql here and the
# decisions are the real code. Same split as finds/score/prove-pipeline.sh.
#
# D6: two throwaway candidates under .invalid (RFC 2606, can never resolve),
# living only inside a cluster that is destroyed on exit. No fixture file is
# committed, nothing here can reach a real table, and nothing is published to
# the internet.
#
# Needs a local Postgres (initdb/pg_ctl/psql) and node >= 22. No credential and
# no network.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLUSTER="$(mktemp -d "${TMPDIR:-/tmp}/finds-w11-publish.XXXXXX")"
PORT=$(( 15432 + RANDOM % 2000 ))
trap 'pg_ctl -D "$CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$CLUSTER"' EXIT

initdb -D "$CLUSTER/data" -U postgres --auth=trust >"$CLUSTER/initdb.log" 2>&1
pg_ctl -D "$CLUSTER/data" -o "-k $CLUSTER -p $PORT -c listen_addresses=127.0.0.1" \
       -l "$CLUSTER/pg.log" -w start >/dev/null

DB="postgresql://postgres@127.0.0.1:$PORT/postgres"
psql() { command psql "$DB" -X -q -v ON_ERROR_STOP=1 "$@"; }
q()    { command psql "$DB" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }

psql -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
         GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
         ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT ALL ON TABLES TO anon, authenticated, service_role;"
export PGOPTIONS="-c client_min_messages=warning"
for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do psql -f "$migration" >/dev/null; done
unset PGOPTIONS

# ---------------------------------------------------------------------------
# A crawl and a scoring that already happened, in the shapes W4 and W5 write.
#
#   w11-own    a product on its own domain. Clean. Should publish.
#   w11-host   a tenant at /maker/w11-tool on a SHARED host, scored partly on
#              /pricing -- a page the HOST wrote. This is D23's mechanism, and
#              it is the shape 45% of one real day's candidates had.
#
# TWO NAMED GENERATIONS, defined once and never spelled out again. Evidence is
# append-only, so a candidate really does accumulate them: GEN_A is one crawl
# pass over BOTH candidates (a pass covers many), and GEN_B is a later re-crawl
# of w11-own alone. Every insert below takes the generation as an argument, so
# no literal run id survives outside these two lines and a citation cannot be
# pointed at the wrong generation by accident -- it would have to be asked for.
# That is W5's shape, adopted after its fixture hit the same constraint: a
# fixture that does not model the invariant the production code maintains will
# eventually assert something production would never do.
#
# One transaction, because D7's constraint trigger is DEFERRABLE INITIALLY
# DEFERRED: a verdict and its citations must commit together or not at all.
# ---------------------------------------------------------------------------
psql >/dev/null <<'SETUP'
\set GEN_A 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set GEN_B 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
BEGIN;
INSERT INTO finds_sources (slug, display_name, homepage_url) VALUES
  ('w11_proof', 'W11 Proof Source', 'https://w11-source.invalid/');

INSERT INTO finds_candidates (product_url, name, tagline, status) VALUES
  ('https://w11-own.invalid/', 'Throwaway offline transcriber (W11 proof)',
   'transcribes locally, no upload', 'scored'),
  ('https://w11-host.invalid/maker/w11-tool', 'Throwaway hosted tool (W11 proof)',
   'a tool living under a path on a shared host', 'scored');

INSERT INTO finds_candidate_sightings (candidate_id, source_id, external_id, source_url)
SELECT c.id, s.id, 'ext-' || left(c.id::text, 8), s.homepage_url
  FROM finds_candidates c CROSS JOIN finds_sources s;

-- ALLOW verdicts, each carrying the USE rights R2's rubric produces. The
-- /legal page is fetchable but carries a `noindex`, so it may be linked and
-- not excerpted -- W11 is the only lane that can honour that difference.
INSERT INTO finds_crawl_verdicts (rubric_version, gate_version, candidate_id, url, authority,
       registrable_domain, allowed, reason_code, reason_detail, deciding_signal, expires_at, use_rights)
SELECT '1.1', 'w11-publish-proof', c.id, p.url,
       'https://' || split_part(split_part(p.url, '//', 2), '/', 1),
       split_part(split_part(p.url, '//', 2), '/', 1),
       true, 'robots_absent', 'no robots.txt served', 'ROBOTS_TXT', NOW() + INTERVAL '1 day',
       p.rights::jsonb
  FROM finds_candidates c
  CROSS JOIN LATERAL (VALUES
    ('https://w11-own.invalid/',        'own',  '{"llm_ingest":true,"publish_excerpt":true,"publish_link":true,"follow_links":true,"store_raw_body":true,"train":false,"max_snippet_chars":null,"reserved_by":[]}'),
    ('https://w11-own.invalid/docs',    'own',  '{"llm_ingest":true,"publish_excerpt":true,"publish_link":true,"follow_links":true,"store_raw_body":true,"train":false,"max_snippet_chars":null,"reserved_by":[]}'),
    ('https://w11-own.invalid/legal',   'own',  '{"llm_ingest":true,"publish_excerpt":false,"publish_link":true,"follow_links":false,"store_raw_body":true,"train":false,"max_snippet_chars":null,"reserved_by":[{"signal":"X_ROBOTS_TAG","directive":"noindex","source_url":"https://w11-own.invalid/legal","restricts":["publish_excerpt"]}]}'),
    ('https://w11-host.invalid/maker/w11-tool', 'host', '{"llm_ingest":true,"publish_excerpt":true,"publish_link":true,"follow_links":true,"store_raw_body":true,"train":false,"max_snippet_chars":null,"reserved_by":[]}'),
    ('https://w11-host.invalid/pricing',        'host', '{"llm_ingest":true,"publish_excerpt":true,"publish_link":true,"follow_links":true,"store_raw_body":true,"train":false,"max_snippet_chars":null,"reserved_by":[]}')
  ) AS p(url, owner, rights)
 WHERE (p.owner = 'own'  AND c.product_url = 'https://w11-own.invalid/')
    OR (p.owner = 'host' AND c.product_url = 'https://w11-host.invalid/maker/w11-tool');

-- The crawl itself, once per generation. The quote carries its generation's
-- label so the published page can be checked against the run it came from.
INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url, page_role,
       http_status, fetched_at, quotes)
SELECT v.candidate_id, v.id, g.run::uuid, v.url,
       CASE WHEN v.url LIKE '%/docs' THEN 'docs'
            WHEN v.url LIKE '%/pricing' THEN 'pricing'
            WHEN v.url LIKE '%/legal' THEN 'other'
            ELSE 'homepage' END,
       200, NOW() - g.age,
       CASE WHEN v.url = 'https://w11-host.invalid/pricing'
            THEN ('[{"text":"' || g.label || ': Start a free 30 day trial today"}]')::jsonb
            ELSE ('[{"text":"' || g.label || ': quoted from ' || v.url || '"}]')::jsonb END
  FROM finds_crawl_verdicts v
  JOIN finds_candidates c ON c.id = v.candidate_id
  CROSS JOIN LATERAL (VALUES
    (:'GEN_A', 'first crawl', INTERVAL '2 days'),
    (:'GEN_B', 're-crawl',    INTERVAL '1 hour')
  ) AS g(run, label, age)
 WHERE g.run = :'GEN_A' OR c.product_url = 'https://w11-own.invalid/';

-- Four criteria per GENERATION, not per candidate: a re-crawl is re-scored.
-- created_at is explicit because every row in one transaction shares NOW(),
-- and db.ts picks the most recently scored generation -- so without a real gap
-- there would be nothing to pick between. GEN_A's scores are deliberately 0 so
-- the published numbers can be traced to the generation they came from.
-- On the hosted candidate C1 cites the HOST's pricing page as a contradiction:
-- that is the exact fabrication V1 found in a real run.
INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score, rationale,
       scored_by, rubric_version, created_at)
SELECT e.candidate_id, e.crawl_run_id, k.criterion,
       CASE WHEN e.crawl_run_id::text = :'GEN_A' THEN 0 ELSE k.score END,
       'proof rationale for ' || k.criterion, 'rubric', '1.0',
       NOW() - CASE WHEN e.crawl_run_id::text = :'GEN_A'
                    THEN INTERVAL '2 days' ELSE INTERVAL '1 hour' END
  FROM (SELECT DISTINCT candidate_id, crawl_run_id FROM finds_evidence) e
  CROSS JOIN (VALUES ('C1', 2), ('C2', 1), ('C3', 2), ('C4', 3)) AS k(criterion, score);

-- THE GENERATION IS THE JOIN KEY, not an afterthought. A citation is scoped to
-- the run its verdict scored -- the same narrowing loadGeneration() performs in
-- production, and what migration 20260828211000's three-column foreign key now
-- enforces. evidence_run_id is taken from the verdict for the same reason
-- finds_write_verdict takes it from its argument: never from the citation.
INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id, evidence_run_id, stance)
SELECT v.id, e.id, v.candidate_id, v.evidence_run_id,
       CASE WHEN e.url = 'https://w11-host.invalid/pricing' THEN 'contradicts' ELSE 'supports' END
  FROM finds_verdicts v
  JOIN finds_evidence e ON e.candidate_id = v.candidate_id AND e.crawl_run_id = v.evidence_run_id
 WHERE (v.criterion = 'C1' AND e.url IN ('https://w11-own.invalid/', 'https://w11-host.invalid/pricing'))
    OR (v.criterion = 'C2' AND e.url IN ('https://w11-own.invalid/docs', 'https://w11-host.invalid/maker/w11-tool'))
    OR (v.criterion = 'C3' AND e.url IN ('https://w11-own.invalid/legal', 'https://w11-host.invalid/maker/w11-tool'))
    OR (v.criterion = 'C4' AND e.url IN ('https://w11-own.invalid/docs', 'https://w11-host.invalid/maker/w11-tool'));
COMMIT;
SETUP

cd "$REPO_ROOT"

# The chat id an approval must carry. Nikhil's real one is a secret and is not
# here; this is a throwaway that exists for the length of this process, and the
# point being proven is that the check runs at all.
export TELEGRAM_CHAT_ID="w11-proof-chat"

# ---------------------------------------------------------------------------
# Build the offline input for one candidate: exactly the reads db.ts performs,
# in SQL, because this cluster has no PostgREST in front of it.
# ---------------------------------------------------------------------------
input_for() {
  q "
  WITH c AS (SELECT * FROM finds_candidates WHERE product_url = '$1'),
       run AS (SELECT evidence_run_id FROM finds_verdicts
                WHERE candidate_id = (SELECT id FROM c)
                ORDER BY created_at DESC LIMIT 1)
  SELECT json_build_object(
    'source', json_build_object(
      'candidate', json_build_object('id', c.id, 'name', c.name, 'tagline', c.tagline,
                                     'product_url', c.product_url, 'first_seen_at', c.first_seen_at),
      'source_labels', (SELECT coalesce(json_agg(DISTINCT s.display_name), '[]'::json)
                          FROM finds_candidate_sightings cs JOIN finds_sources s ON s.id = cs.source_id
                         WHERE cs.candidate_id = c.id),
      'evidence_run_id', (SELECT evidence_run_id FROM run),
      'scores', (SELECT json_agg(json_build_object('criterion', v.criterion, 'score', v.score) ORDER BY v.criterion)
                   FROM finds_verdicts v
                  WHERE v.candidate_id = c.id AND v.evidence_run_id = (SELECT evidence_run_id FROM run)),
      'citations', (SELECT coalesce(json_strip_nulls(json_agg(json_build_object(
                             'criterion', v.criterion, 'url', e.url, 'quote', e.quotes->0->>'text',
                             'stance', ve.stance, 'use_rights', cv.use_rights)
                           ORDER BY v.criterion, e.url)), '[]'::json)
                      FROM finds_verdict_evidence ve
                      JOIN finds_verdicts v ON v.id = ve.verdict_id
                      JOIN finds_evidence e ON e.id = ve.evidence_id
                      JOIN finds_crawl_verdicts cv ON cv.id = e.crawl_verdict_id
                     WHERE v.candidate_id = c.id AND v.evidence_run_id = (SELECT evidence_run_id FROM run))),
    'options', json_build_object(
      'approval', json_build_object('candidate_id', c.id, 'channel', 'telegram',
                   'chat_id', '$TELEGRAM_CHAT_ID', 'message_id', 7,
                   'answered_at', '2026-08-28T21:00:00Z', 'answer', 'yes, publish this one',
                   'why_interesting', 'the only one I would actually install'),
      'published_at', $2))
    FROM c;"
}

insert_row() {
  psql -c "INSERT INTO finds_published (candidate_id, slug, name, tagline, product_url, source_labels,
                found_at, published_at, score_claim_verified, score_rare_problem, score_anyone_can_use,
                score_agentic_friendly, citations, why_interesting)
           SELECT candidate_id, slug, name, tagline, product_url, source_labels, found_at, published_at,
                  score_claim_verified, score_rare_problem, score_anyone_can_use, score_agentic_friendly,
                  citations, why_interesting
             FROM jsonb_populate_record(NULL::finds_published, \$w11\$$1\$w11\$::jsonb);" >/dev/null
}

# W7's useFinds, in SQL: the anon role, RLS on, no published_at filter of its
# own -- the policy is the filter.
anon_sees() { q "SET ROLE anon; SELECT count(*) FROM finds_published;"; }

# ---------------------------------------------------------------------------
echo "=== 1. the D23 candidate: a tenant scored on its host's own page ==="
OUT=$(input_for 'https://w11-host.invalid/maker/w11-tool' 'NULL' | node finds/publish/offline.ts)
echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const o=JSON.parse(s);
  if(o.row){console.error("FAIL: D23 candidate was published");process.exit(1)}
  for(const r of o.refusals) console.log("  REFUSED  "+r);
})'
test "$(q 'SELECT count(*) FROM finds_published;')" = "0"
echo "PASS  nothing reached finds_published"

echo
echo "=== 2. the clean candidate, drafted (published_at NULL) ==="
ROW=$(input_for 'https://w11-own.invalid/' 'NULL' | node finds/publish/offline.ts \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);
        if(!o.row){console.error(JSON.stringify(o,null,2));process.exit(1)}
        for(const n of o.notes) console.error("  note: "+n);
        console.log(JSON.stringify(o.row))})')
insert_row "$ROW"
psql -c "UPDATE finds_candidates SET status = 'published' WHERE product_url = 'https://w11-own.invalid/';" >/dev/null
echo "  service_role rows: $(q 'SELECT count(*) FROM finds_published;')   anon rows: $(anon_sees)"
test "$(anon_sees)" = "0"
echo "PASS  a drafted find is invisible to the site"

echo
echo "=== 3. scheduled for the future ==="
psql -c "UPDATE finds_published SET published_at = NOW() + INTERVAL '1 day';" >/dev/null
echo "  anon rows: $(anon_sees)"
test "$(anon_sees)" = "0"
echo "PASS  a scheduled find is invisible until its time"

echo
echo "=== 4. published ==="
psql -c "UPDATE finds_published SET published_at = NOW() - INTERVAL '1 minute';" >/dev/null
test "$(anon_sees)" = "1"
echo "  what W7's useFinds gets back, as the anon role with RLS on:"
command psql "$DB" -X -q -v ON_ERROR_STOP=1 -c \
  "SET ROLE anon;
   SELECT slug, name, product_url, source_labels,
          score_claim_verified AS c1, score_rare_problem AS c2,
          score_anyone_can_use AS c3, score_agentic_friendly AS c4,
          why_interesting
     FROM finds_published ORDER BY published_at DESC;"
command psql "$DB" -X -q -v ON_ERROR_STOP=1 -c \
  "SET ROLE anon;
   SELECT jsonb_pretty(citations) FROM finds_published;"
psql -c "DO \$\$ BEGIN
  ASSERT (SELECT bool_and(j->>'quote' LIKE 're-crawl:%')
            FROM finds_published, jsonb_array_elements(citations) j WHERE j ? 'quote'),
         'a published quote must come from the generation the published score was read from';
  ASSERT (SELECT score_agentic_friendly FROM finds_published) = 3,
         'the published score must come from the newest scored generation, not the first crawl';
  ASSERT NOT EXISTS (SELECT 1 FROM finds_published, jsonb_array_elements(citations) j
                      WHERE j->>'url' LIKE '%/legal' AND j ? 'quote'),
         'a noindex page may be linked and not excerpted';
END \$\$;" >/dev/null
echo "PASS  the site can read it, from the generation it was last scored on"

echo
echo "=== 5. unpublish: published_at = NULL, the row stays ==="
SLUG=$(q "SELECT slug FROM finds_published LIMIT 1;")
psql -c "UPDATE finds_published SET published_at = NULL WHERE slug = \$w11\$$SLUG\$w11\$;" >/dev/null
echo "  anon rows: $(anon_sees)   rows still on file: $(q 'SELECT count(*) FROM finds_published;')"
test "$(anon_sees)" = "0"
test "$(q 'SELECT count(*) FROM finds_published;')" = "1"
echo "PASS  a takedown hides the find without erasing what was claimed"

echo
echo "=== 6. the citations that survived, and why ==="
command psql "$DB" -X -q -v ON_ERROR_STOP=1 -c \
  "SELECT j->>'criterion' AS criterion, j->>'url' AS url, j->>'stance' AS stance,
          coalesce(j->>'quote', '(no quote -- the page refuses a public excerpt)') AS quote
     FROM finds_published, jsonb_array_elements(citations) j ORDER BY 1, 2;"
echo
echo "ALL PASS"
