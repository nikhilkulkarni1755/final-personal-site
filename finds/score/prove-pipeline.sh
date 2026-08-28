#!/usr/bin/env bash
# Run the REAL scoring code against a real Postgres, end to end.
#
# prove-d7.sh proves the schema refuses a bad write. This proves the other
# direction: that finds/score/run.ts actually executes -- W8 found that Node's
# native type stripping rejects TS syntax that `tsc --noEmit` is perfectly
# happy with, so a lane that only typechecks has proven nothing about whether
# its code runs -- and that scoring and selection produce the right answers
# against rows read back out of Postgres rather than handed to a function.
#
# What it does NOT prove: anything about W4's crawler. The evidence rows below
# are built inline in the shapes W4's finds/verify/{claims,signals}.ts emit,
# because per D11 no live third-party crawl may run yet. When W4 produces a
# real generation, that is the run that replaces this one.
#
# D6: two candidates, both under .invalid (RFC 2606, can never resolve), living
# only inside a throwaway cluster that is destroyed on exit. No fixture file is
# committed and nothing here can reach a real table.
#
# Needs a local Postgres (initdb/pg_ctl/psql), node >= 22, and `pg` installed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! node --input-type=module -e 'import("pg")' >/dev/null 2>&1; then
    echo "FAIL: the 'pg' package is not installed in $REPO_ROOT. Run 'npm install' first." >&2
    exit 1
fi

CLUSTER="$(mktemp -d "${TMPDIR:-/tmp}/finds-w5-pipeline.XXXXXX")"
PORT=$(( 15432 + RANDOM % 2000 ))
trap 'pg_ctl -D "$CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$CLUSTER"' EXIT

initdb -D "$CLUSTER/data" -U postgres --auth=trust >"$CLUSTER/initdb.log" 2>&1
pg_ctl -D "$CLUSTER/data" -o "-k $CLUSTER -p $PORT -c listen_addresses=127.0.0.1" \
       -l "$CLUSTER/pg.log" -w start >/dev/null

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
psql() { command psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

psql -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
         GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
         ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT ALL ON TABLES TO anon, authenticated, service_role;"
export PGOPTIONS="-c client_min_messages=warning"
for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do psql -f "$migration" >/dev/null; done
unset PGOPTIONS

# ---------------------------------------------------------------------------
# A crawl that already happened. Observation kinds and shapes are exactly the
# ones W4's claims.ts and signals.ts emit -- that coupling is the contract, and
# writing them out here is what makes it testable before W4 ships evidence.
# ---------------------------------------------------------------------------
psql >/dev/null <<'SETUP'
INSERT INTO finds_sources (slug, display_name, homepage_url) VALUES
  ('peerlist', 'Peerlist Launchpad', 'https://peerlist.io/launchpad'),
  ('show_hn',  'Show HN',            'https://news.ycombinator.com/show');

INSERT INTO finds_candidates (product_url, name, tagline, status) VALUES
  ('https://w5-strong.invalid/', 'Throwaway scheduling assistant (W5 proof)',
   'a scheduling assistant with an MCP server', 'crawled'),
  ('https://w5-waitlist.invalid/', 'Throwaway design canvas (W5 proof)',
   'a design collaboration canvas', 'crawled');

INSERT INTO finds_candidate_sightings (candidate_id, source_id, external_id, source_url)
SELECT c.id, s.id, 'ext-' || s.slug || '-' || left(c.id::text, 8), s.homepage_url
  FROM finds_candidates c CROSS JOIN finds_sources s
 WHERE (c.product_url = 'https://w5-strong.invalid/'   AND s.slug = 'peerlist')
    OR (c.product_url = 'https://w5-waitlist.invalid/' AND s.slug = 'show_hn');

-- One ALLOW per candidate, plus a DENY on the strong one so the refused count
-- is real and shows up in its rationales.
INSERT INTO finds_crawl_verdicts (rubric_version, gate_version, candidate_id, url, authority,
       registrable_domain, allowed, reason_code, reason_detail, deciding_signal, expires_at)
SELECT '1.1', 'w5-pipeline-proof', id, product_url,
       'https://' || split_part(split_part(product_url, '//', 2), '/', 1),
       split_part(split_part(product_url, '//', 2), '/', 1),
       true, 'robots_absent', 'no robots.txt served', 'ROBOTS_TXT', NOW() + INTERVAL '1 day'
  FROM finds_candidates;

INSERT INTO finds_crawl_verdicts (rubric_version, gate_version, candidate_id, url, authority,
       registrable_domain, allowed, reason_code, reason_detail, deciding_signal, expires_at)
SELECT '1.1', 'w5-pipeline-proof', id, product_url || 'admin', 'https://w5-strong.invalid',
       'w5-strong.invalid', false, 'robots_disallow', 'Disallow: /admin', 'ROBOTS_TXT',
       NOW() + INTERVAL '1 day'
  FROM finds_candidates WHERE product_url = 'https://w5-strong.invalid/';

-- The strong candidate: claims that corroborate, an open funnel, a linked MCP
-- endpoint. Should reach the digest.
INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url, page_role, http_status, observations)
SELECT v.candidate_id, v.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p.url, p.role, 200, p.obs::jsonb
  FROM finds_crawl_verdicts v
  JOIN finds_candidates c ON c.id = v.candidate_id
  CROSS JOIN (VALUES
    ('https://w5-strong.invalid/', 'homepage', '[
        {"kind":"c1_corroborated","detail":"claim A echoed on /docs","value":"https://w5-strong.invalid/docs"},
        {"kind":"c1_corroborated","detail":"claim B echoed on /docs","value":"https://w5-strong.invalid/docs"},
        {"kind":"c1_corroborated","detail":"claim C echoed on /pricing","value":"https://w5-strong.invalid/pricing"},
        {"kind":"c1_unsubstantiated","detail":"claim D found nothing either way","value":null},
        {"kind":"c2_problem_statement","detail":"why we built this","value":"https://w5-strong.invalid/"},
        {"kind":"c2_named_alternatives","detail":"names none","value":0},
        {"kind":"c3_free_tier","detail":"free tier advertised","value":"https://w5-strong.invalid/"},
        {"kind":"c3_no_card_required","detail":"no credit card required","value":"https://w5-strong.invalid/"},
        {"kind":"c4_mcp","detail":"an MCP server is advertised","value":"https://w5-strong.invalid/"}
     ]'),
    ('https://w5-strong.invalid/pricing', 'pricing', '[
        {"kind":"c3_pricing_page","detail":"readable","value":"https://w5-strong.invalid/pricing"}
     ]'),
    ('https://w5-strong.invalid/docs', 'docs', '[
        {"kind":"c4_mcp_endpoint_linked","detail":"linked","value":"https://w5-strong.invalid/mcp"},
        {"kind":"c4_openapi_spec_linked","detail":"linked","value":"https://w5-strong.invalid/openapi.json"}
     ]')
  ) AS p(url, role, obs)
 WHERE c.product_url = 'https://w5-strong.invalid/' AND v.allowed;

-- The waitlist candidate: perfect on paper, but nobody can use it. C3 = 0, so
-- it must be rejected however good the rest looks.
INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url, page_role, http_status, observations)
SELECT v.candidate_id, v.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'https://w5-waitlist.invalid/', 'homepage', 200, '[
        {"kind":"c1_corroborated","detail":"claim A echoed","value":"https://w5-waitlist.invalid/about"},
        {"kind":"c1_corroborated","detail":"claim B echoed","value":"https://w5-waitlist.invalid/about"},
        {"kind":"c1_corroborated","detail":"claim C echoed","value":"https://w5-waitlist.invalid/about"},
        {"kind":"c2_problem_statement","detail":"why we built this","value":"https://w5-waitlist.invalid/"},
        {"kind":"c2_named_alternatives","detail":"names none","value":0},
        {"kind":"c3_waitlist","detail":"join the waitlist","value":"https://w5-waitlist.invalid/"},
        {"kind":"c4_api","detail":"a documented API is advertised","value":"https://w5-waitlist.invalid/"},
        {"kind":"c4_cli","detail":"a CLI is advertised","value":"https://w5-waitlist.invalid/"}
     ]'::jsonb
  FROM finds_crawl_verdicts v
  JOIN finds_candidates c ON c.id = v.candidate_id
 WHERE c.product_url = 'https://w5-waitlist.invalid/' AND v.allowed;
SETUP

cd "$REPO_ROOT"

echo "--- node finds/score/run.ts score ---"
node finds/score/run.ts score | sed 's/^/    /'

psql -c "DO \$\$ BEGIN
  ASSERT (SELECT count(*) FROM finds_verdicts) = 8, 'expected 4 criteria x 2 candidates';
  ASSERT (SELECT count(*) FROM finds_verdict_evidence) > 0, 'every verdict must cite evidence';
  ASSERT (SELECT count(*) FROM finds_candidates WHERE status = 'scored') = 2, 'both should be marked scored';
  ASSERT (SELECT score FROM finds_verdicts v JOIN finds_candidates c ON c.id = v.candidate_id
           WHERE c.product_url = 'https://w5-waitlist.invalid/' AND v.criterion = 'C3') = 0,
         'a waitlist must score C3 = 0';
  ASSERT (SELECT score FROM finds_verdicts v JOIN finds_candidates c ON c.id = v.candidate_id
           WHERE c.product_url = 'https://w5-strong.invalid/' AND v.criterion = 'C4') = 3,
         'a linked MCP endpoint must score C4 = 3';
  ASSERT (SELECT score FROM finds_verdicts v JOIN finds_candidates c ON c.id = v.candidate_id
           WHERE c.product_url = 'https://w5-strong.invalid/' AND v.criterion = 'C2') = 2,
         'C2 is capped at 2 under rubric 1.0';
  ASSERT (SELECT bool_and(rationale LIKE '%1 URL(s) refused by the permission gate.')
            FROM finds_verdicts v JOIN finds_candidates c ON c.id = v.candidate_id
           WHERE c.product_url = 'https://w5-strong.invalid/'),
         'every rationale must state the gate refusal it could not see in evidence';
  ASSERT (SELECT bool_and(scored_by LIKE 'rubric/%') FROM finds_verdicts),
         'the rubric version must travel with every verdict';
END \$\$;" >/dev/null
echo "PASS  verdicts written from real rows, with citations, statuses and refusal counts"

echo
echo "--- node finds/score/run.ts select 2026-08-28 ---"
node finds/score/run.ts select 2026-08-28 | sed 's/^/    /'

SELECTED=$(node finds/score/run.ts select 2026-08-28)
# Split at the rejection listing: appearing in it is the OPPOSITE of being picked.
PICKED=$(sed '/^Not selected/,$d' <<<"$SELECTED")
grep -q 'scheduling assistant' <<<"$PICKED" || { echo "FAIL: the usable product was not picked" >&2; exit 1; }
grep -q 'design canvas' <<<"$PICKED" && { echo "FAIL: a waitlisted product reached the digest" >&2; exit 1; }
grep -q 'design canvas.*contradicted -- C3 scored 0' <<<"$SELECTED" || { echo "FAIL: rejected, but not for the waitlist" >&2; exit 1; }
echo "PASS  selection rejected the waitlisted product BY NAME of the criterion it failed"

# Re-scoring must be idempotent: same evidence, same verdicts, no duplicates.
psql -c "UPDATE finds_candidates SET status = 'crawled';" >/dev/null
node finds/score/run.ts score >/dev/null
psql -c "DO \$\$ BEGIN
  ASSERT (SELECT count(*) FROM finds_verdicts) = 8, 're-scoring must update in place, not duplicate';
END \$\$;" >/dev/null
echo "PASS  re-scoring the same evidence is idempotent"

echo
echo "The scoring code runs, against Postgres, on rows read back out of it."
