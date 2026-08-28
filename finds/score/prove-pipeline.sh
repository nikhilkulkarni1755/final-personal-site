#!/usr/bin/env bash
# Run the REAL scoring code against a real Postgres, end to end.
#
# prove-d7.sh proves the schema refuses a bad write. This proves the other
# direction: that this lane's code actually EXECUTES -- W8 found that Node's
# native type stripping rejects TS syntax `tsc --noEmit` is perfectly happy
# with, so a lane that only typechecks has proven nothing about whether its
# code runs -- and that scoring and selection produce the right answers on rows
# that came out of a real Postgres rather than out of a test fixture.
#
# The code is driven through finds/score/offline.ts rather than run.ts, because
# run.ts speaks supabase-js (D17) and a throwaway cluster has no PostgREST in
# front of it. Everything under test is the same: scoreCandidate,
# buildVerdictWrite, selectForDay, toDigestInput, and the real
# finds_write_verdict function. What is NOT proven here is db.ts's supabase-js
# binding, which needs a live Supabase project.
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
# Needs a local Postgres (initdb/pg_ctl/psql) and node >= 22. No credential and
# no network: it never touches Nikhil's database.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
        {"kind":"c4_cli_absent","detail":"no CLI mentioned","value":false},
        {"kind":"c4_llms_txt_absent","detail":"llms.txt was never reachable","value":null}
     ]'::jsonb
  FROM finds_crawl_verdicts v
  JOIN finds_candidates c ON c.id = v.candidate_id
 WHERE c.product_url = 'https://w5-waitlist.invalid/' AND v.allowed;
SETUP

cd "$REPO_ROOT"

q() { command psql "$DATABASE_URL" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }

# ---------------------------------------------------------------------------
# Score every crawled candidate: Postgres -> the real scorer -> the real
# finds_write_verdict function -> Postgres.
# ---------------------------------------------------------------------------
echo "--- scoring, through finds/score/offline.ts ---"
for url in https://w5-strong.invalid/ https://w5-waitlist.invalid/; do
    INPUT=$(q "
      SELECT json_build_object(
        'candidate_id', c.id,
        'candidate_status', c.status,
        'evidence_run_id', (SELECT crawl_run_id FROM finds_evidence
                             WHERE candidate_id = c.id ORDER BY fetched_at DESC LIMIT 1),
        'urls_refused', (SELECT count(*) FROM finds_crawl_verdicts
                          WHERE candidate_id = c.id AND allowed = false),
        'rows', COALESCE((SELECT json_agg(e) FROM finds_evidence e WHERE e.candidate_id = c.id), '[]'::json))
        FROM finds_candidates c WHERE c.product_url = '$url';")

    OUTPUT=$(node finds/score/offline.ts score <<<"$INPUT")
    PAYLOAD=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);if(!o.payload){console.error(o.detail??"no payload");process.exit(1)}console.log(JSON.stringify(o.payload.p_verdicts))})' <<<"$OUTPUT")
    RUBRIC=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).payload.p_rubric_version))' <<<"$OUTPUT")
    CID=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).payload.p_candidate_id))' <<<"$OUTPUT")
    RUN=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).payload.p_evidence_run_id))' <<<"$OUTPUT")

    WRITTEN=$(q "SELECT finds_write_verdict('$CID'::uuid, '$RUN'::uuid, '$RUBRIC', \$w5\$$PAYLOAD\$w5\$::jsonb);")
    q "UPDATE finds_candidates SET status = 'scored' WHERE id = '$CID';" >/dev/null
    echo "    $url  ->  $WRITTEN verdicts written"
done

psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN
  ASSERT (SELECT count(*) FROM finds_verdicts) = 8, 'expected 4 criteria x 2 candidates';
  ASSERT (SELECT count(*) FROM finds_verdict_evidence) > 0, 'every verdict must cite evidence';
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
  ASSERT (SELECT bool_and(scored_by = 'rubric') FROM finds_verdicts),
         'scored_by says WHO scored it';
  ASSERT (SELECT bool_and(rubric_version = '1.0') FROM finds_verdicts),
         'rubric_version says under WHICH RULES, in its own column';
  ASSERT (SELECT count(*) FROM finds_verdict_evidence WHERE stance = 'inconclusive') > 0,
         'a score of 1 must cite the rows that settled nothing AS inconclusive';
  ASSERT (SELECT bool_and(e.crawl_run_id = v.evidence_run_id)
            FROM finds_verdict_evidence ve
            JOIN finds_verdicts v ON v.id = ve.verdict_id
            JOIN finds_evidence  e ON e.id = ve.evidence_id),
         'every citation must belong to the generation its verdict scored';
END \$\$;" >/dev/null
echo "PASS  verdicts written from real rows, with citations, stances, rubric version and refusal counts"

# ---------------------------------------------------------------------------
# Select the day, and build the handoff W6 sends.
# ---------------------------------------------------------------------------
SELECT_INPUT=$(q "
  SELECT json_build_object('date', '2026-08-28', 'candidates', json_agg(x)) FROM (
    SELECT c.id AS candidate_id, c.name, c.tagline, c.product_url, c.first_seen_at,
           (SELECT v.evidence_run_id FROM finds_verdicts v
             WHERE v.candidate_id = c.id ORDER BY v.created_at DESC LIMIT 1) AS evidence_run_id,
           COALESCE((SELECT array_agg(DISTINCT s.slug) FROM finds_candidate_sightings sg
                       JOIN finds_sources s ON s.id = sg.source_id
                      WHERE sg.candidate_id = c.id), ARRAY[]::text[]) AS source_slugs,
           (SELECT jsonb_object_agg(v.criterion, v.score) FROM finds_verdicts v
             WHERE v.candidate_id = c.id) AS scores,
           (SELECT jsonb_object_agg(v.criterion, v.rationale) FROM finds_verdicts v
             WHERE v.candidate_id = c.id) AS rationales
      FROM finds_undigested_candidates c) x;")

RESULT=$(node finds/score/offline.ts select <<<"$SELECT_INPUT")
node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const { selection, digest } = JSON.parse(s);
  console.log("    " + selection.summary);
  for (const p of selection.picks) console.log(`    PICK ${p.name} -- ${p.why}`);
  for (const r of selection.rejected) console.log(`    DROP ${r.name}: ${r.reason} -- ${r.detail}`);
  const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
  if (selection.picks.length !== 1) fail("expected exactly one pick");
  if (!selection.picks[0].name.includes("scheduling assistant")) fail("the usable product was not picked");
  const dropped = selection.rejected.find(r => r.name.includes("design canvas"));
  if (!dropped) fail("a waitlisted product was not rejected");
  if (dropped.reason !== "contradicted" || !dropped.detail.startsWith("C3 scored 0")) fail("rejected, but not for the waitlist");
  if (!digest || digest.digest.finds.length !== 1) fail("the digest handoff was not produced");
  const find = digest.digest.finds[0];
  if (find.criteria.length !== 4) fail("the digest needs all four criteria");
  const c1 = find.criteria.find(c => c.id === "C1");
  if (c1.score === undefined || c1.status === undefined) fail("C1 must carry both its score and its three-way status");
  if (find.criteria.some(c => "verdict" in c)) fail("the flattening boolean must be gone");
  if (digest.candidateIds.length !== digest.digest.finds.length) fail("candidate ids must align with finds");
});' <<<"$RESULT"
echo "PASS  selection picked the usable product, rejected the waitlisted one by criterion, and produced W6's handoff"

# Re-scoring must be idempotent: same evidence, same verdicts, no duplicates.
CID=$(q "SELECT id FROM finds_candidates WHERE product_url = 'https://w5-strong.invalid/';")
RUN=$(q "SELECT crawl_run_id FROM finds_evidence WHERE candidate_id = '$CID' LIMIT 1;")
INPUT=$(q "
  SELECT json_build_object('candidate_id','$CID','candidate_status','crawled','evidence_run_id','$RUN',
    'urls_refused',1,'rows',(SELECT json_agg(e) FROM finds_evidence e WHERE e.candidate_id='$CID'));")
PAYLOAD=$(node finds/score/offline.ts score <<<"$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).payload.p_verdicts)))')
q "SELECT finds_write_verdict('$CID'::uuid, '$RUN'::uuid, '1.0', \$w5\$$PAYLOAD\$w5\$::jsonb);" >/dev/null
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN
  ASSERT (SELECT count(*) FROM finds_verdicts) = 8, 're-scoring must update in place, not duplicate';
END \$\$;" >/dev/null
echo "PASS  re-scoring the same evidence is idempotent"

echo
echo "The scoring code runs, on rows read out of Postgres, through W3's merged finds_write_verdict."
