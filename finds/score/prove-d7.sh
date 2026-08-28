#!/usr/bin/env bash
# Prove DECISIONS D7 against a real Postgres, using the exact SQL W5 will run.
#
# The rubric's LOGIC is proven by finds/score/c1.test.ts. This proves the other
# half -- that the write path W5 actually uses satisfies the schema's D7
# machinery, and that the machinery refuses everything it claims to refuse.
# A comment asserting "you cannot commit an uncited score" is not evidence;
# watching the COMMIT abort is.
#
# The statements under test are not retyped here. They are printed straight out
# of buildVerdictWrite(), so this cannot drift from the code it is proving.
#
# D6: the rows below are constructed inline, live for the length of one
# throwaway cluster, and are destroyed with it. The product_url is under
# .invalid, which by RFC 2606 can never resolve, so nothing here could be
# mistaken for a real launch even if it escaped. No fixture file is committed.
#
# Needs a local Postgres (initdb/pg_ctl/psql on PATH) and node >= 22.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLUSTER="$(mktemp -d "${TMPDIR:-/tmp}/finds-w5-d7.XXXXXX")"
trap 'pg_ctl -D "$CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$CLUSTER"' EXIT

# The two statements, printed by the code under test rather than copied.
PLAN_JS='
import { buildVerdictWrite } from "./finds/score/persist.ts";
const zero = "00000000-0000-4000-8000-000000000000";
const plan = buildVerdictWrite(zero, zero, [
  { criterion: "C1", score: 3, rationale: "x", rubric_version: "1.0",
    citations: [{ evidence_id: zero, stance: "supports", note: "" }] },
]);
console.log(`PREPARE w5_clear (uuid, uuid, text) AS ${plan[1].text};`);
console.log(`PREPARE w5_write (uuid, uuid, text, smallint, text, text, uuid[], text[]) AS ${plan[2].text};`);
'
PLAN_SQL="$(cd "$REPO_ROOT" && node --input-type=module -e "$PLAN_JS")"

initdb -D "$CLUSTER/data" -U postgres --auth=trust >"$CLUSTER/initdb.log" 2>&1
mkdir -p "$CLUSTER/sock"
pg_ctl -D "$CLUSTER/data" -o "-k $CLUSTER/sock -c listen_addresses=''" \
       -l "$CLUSTER/pg.log" -w start >/dev/null

psql() { command psql -h "$CLUSTER/sock" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

psql -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
         GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
         ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT ALL ON TABLES TO anon, authenticated, service_role;"
# Migration NOTICEs (idempotent DROP ... IF EXISTS) are not this test's output.
export PGOPTIONS="-c client_min_messages=warning"
for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do psql -f "$migration" >/dev/null; done
unset PGOPTIONS

# --- the minimum real chain a verdict needs: candidate -> ALLOW -> evidence ---
psql >/dev/null <<'SETUP'
INSERT INTO finds_candidates (product_url, name, tagline)
VALUES ('https://w5-d7-proof.invalid/', 'W5 D7 proof (throwaway)', 'exists only inside this test cluster');

INSERT INTO finds_crawl_verdicts (rubric_version, gate_version, candidate_id, url, authority,
       registrable_domain, allowed, reason_code, reason_detail, deciding_signal, expires_at)
SELECT '1.1', 'w5-proof', id, product_url, 'https://w5-d7-proof.invalid', 'w5-d7-proof.invalid',
       true, 'robots_absent', 'no robots.txt served', 'ROBOTS_TXT', NOW() + INTERVAL '1 day'
  FROM finds_candidates WHERE product_url = 'https://w5-d7-proof.invalid/';

-- Two candidates, so "citing another product's evidence" is testable at all.
INSERT INTO finds_candidates (product_url, name)
VALUES ('https://w5-d7-other.invalid/', 'W5 D7 other candidate (throwaway)');
INSERT INTO finds_crawl_verdicts (rubric_version, gate_version, candidate_id, url, authority,
       registrable_domain, allowed, reason_code, reason_detail, deciding_signal, expires_at)
SELECT '1.1', 'w5-proof', id, product_url, 'https://w5-d7-other.invalid', 'w5-d7-other.invalid',
       true, 'robots_absent', 'no robots.txt served', 'ROBOTS_TXT', NOW() + INTERVAL '1 day'
  FROM finds_candidates WHERE product_url = 'https://w5-d7-other.invalid/';

INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url, page_role, http_status, observations)
SELECT v.candidate_id, v.id, '11111111-1111-4111-8111-111111111111', p.url, p.role, 200, p.obs::jsonb
  FROM finds_crawl_verdicts v
  JOIN finds_candidates c ON c.id = v.candidate_id
  CROSS JOIN (VALUES
        ('https://w5-d7-proof.invalid/',        'homepage', '[{"kind":"c1_corroborated","detail":"a"}]'),
        ('https://w5-d7-proof.invalid/docs',    'docs',     '[{"kind":"c1_corroborated","detail":"b"}]'),
        ('https://w5-d7-proof.invalid/pricing', 'pricing',  '[{"kind":"c1_corroborated","detail":"c"}]')
      ) AS p(url, role, obs)
 WHERE c.product_url = 'https://w5-d7-proof.invalid/';

INSERT INTO finds_evidence (candidate_id, crawl_verdict_id, crawl_run_id, url, page_role, http_status)
SELECT v.candidate_id, v.id, '22222222-2222-4222-8222-222222222222', 'https://w5-d7-other.invalid/', 'homepage', 200
  FROM finds_crawl_verdicts v JOIN finds_candidates c ON c.id = v.candidate_id
 WHERE c.product_url = 'https://w5-d7-other.invalid/';
SETUP

IDS="$CLUSTER/ids.sql"
cat >"$IDS" <<'IDSQL'
SELECT id AS cid FROM finds_candidates WHERE product_url = 'https://w5-d7-proof.invalid/' \gset
SELECT id AS oid FROM finds_candidates WHERE product_url = 'https://w5-d7-other.invalid/' \gset
SELECT array_agg(id ORDER BY url) AS eids FROM finds_evidence WHERE candidate_id = :'cid' \gset
SELECT id AS foreign_eid FROM finds_evidence WHERE candidate_id = :'oid' \gset
IDSQL

run() { printf '%s\n%s\n%s\n' "$PLAN_SQL" "$(cat "$IDS")" "$1" | psql -f - ; }

# --------------------------------------------------------------------------
# 1. The happy path: verdict and citations in one transaction, and it commits.
# --------------------------------------------------------------------------
run "
BEGIN;
EXECUTE w5_clear(:'cid', '11111111-1111-4111-8111-111111111111', 'C1');
EXECUTE w5_write(:'cid', '11111111-1111-4111-8111-111111111111', 'C1', 3,
    'CORROBORATED: 3 of 3 checkable claims are echoed on another page of the site.',
    'rubric/1.0', :'eids', ARRAY['supports','supports','supports']);
COMMIT;
DO \$\$ BEGIN
  ASSERT (SELECT count(*) FROM finds_verdicts) = 1, 'expected exactly one verdict';
  ASSERT (SELECT count(*) FROM finds_verdict_evidence) = 3, 'expected three citations';
  ASSERT (SELECT score FROM finds_verdicts) = 3, 'expected the score we wrote';
END \$\$;" >/dev/null
echo "PASS  a cited verdict commits, carrying all three citations"

# --------------------------------------------------------------------------
# 2. Re-scoring the same generation replaces the citations, never accumulates
#    them, and leaves exactly one verdict row.
# --------------------------------------------------------------------------
run "
BEGIN;
EXECUTE w5_clear(:'cid', '11111111-1111-4111-8111-111111111111', 'C1');
EXECUTE w5_write(:'cid', '11111111-1111-4111-8111-111111111111', 'C1', 2,
    'CORROBORATED (partial): re-scored against the same generation.',
    'rubric/1.0', ARRAY[(:'eids'::uuid[])[1]], ARRAY['supports']);
COMMIT;
DO \$\$ BEGIN
  ASSERT (SELECT count(*) FROM finds_verdicts) = 1, 'a re-score must update, not duplicate';
  ASSERT (SELECT count(*) FROM finds_verdict_evidence) = 1, 'stale citations must be gone';
  ASSERT (SELECT score FROM finds_verdicts) = 2, 'the new score must win';
END \$\$;" >/dev/null
echo "PASS  a re-score updates in place and replaces its citations"

# --------------------------------------------------------------------------
# 3-5. The three things the schema must refuse. Each runs in its own psql, and
#      the test is that psql FAILS.
# --------------------------------------------------------------------------
refuses() {
    local label="$1" sql="$2" out
    if out=$(run "$sql" 2>&1); then
        echo "FAIL: $label was accepted" >&2; exit 1
    fi
    if ! grep -qF "$3" <<<"$out"; then
        echo "FAIL: $label failed for the wrong reason:" >&2; echo "$out" >&2; exit 1
    fi
    echo "PASS  $label"
}

refuses "an uncited score aborts at COMMIT" "
BEGIN;
INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score, rationale, scored_by)
VALUES (:'cid', '33333333-3333-4333-8333-333333333333', 'C2', 3, 'it solves a rare problem', 'rubric/1.0');
COMMIT;" "has no cited evidence"

refuses "citing another product's evidence is a foreign-key violation" "
BEGIN;
EXECUTE w5_write(:'cid', '44444444-4444-4444-8444-444444444444', 'C3', 3,
    'usable by anyone', 'rubric/1.0', ARRAY[:'foreign_eid']::uuid[], ARRAY['supports']);
COMMIT;" "finds_verdict_evidence_evidence_fkey"

refuses "stripping a live score's last citation aborts at COMMIT" "
BEGIN;
DELETE FROM finds_verdict_evidence WHERE candidate_id = :'cid';
COMMIT;" "has no cited evidence"

echo
echo "D7 is structural: proven against a real Postgres, using the SQL buildVerdictWrite() emits."
