#!/usr/bin/env bash
# Runs finds/run/daily.ts for real, three ways, and asserts what it does.
#
# A workflow you have never executed is a guess, and the paths that matter in
# an unattended daily job are not the happy path -- they are "a credential is
# missing" and "a source is down". Those are scenarios A and B here. The
# happy-ingest path is C.
#
# Everything runs against a throwaway Postgres cluster created in $TMPDIR and
# destroyed on exit. No real database is touched, nothing is emailed, nothing
# is committed, and the launches ingested in scenario C are REAL Show HN
# posts fetched live (D6 -- there is no fixture).
#
# Needs initdb/pg_ctl/psql on PATH, same as finds/db/test-schema.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLUSTER="$(mktemp -d "${TMPDIR:-/tmp}/finds-run-prove.XXXXXX")"
PGPORT=$(( 49152 + RANDOM % 10000 ))
trap 'pg_ctl -D "$CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$CLUSTER"' EXIT

initdb -D "$CLUSTER/data" -U postgres --auth=trust >"$CLUSTER/initdb.log" 2>&1
pg_ctl -D "$CLUSTER/data" \
       -o "-k $CLUSTER -c listen_addresses=127.0.0.1 -p $PGPORT" \
       -l "$CLUSTER/pg.log" -w start >/dev/null

# client-min-messages=warning: the migrations are idempotent (DROP ... IF
# EXISTS), so applying them to a fresh cluster emits ~30 "does not exist,
# skipping" NOTICEs that bury the output this script exists to show.
psql() { PGOPTIONS='--client-min-messages=warning' \
         command psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
psql -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
         GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;"
for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do psql -f "$migration" >/dev/null; done

cd "$REPO_ROOT"
RUNS="$CLUSTER/runs"
DB_URL="postgresql://postgres@127.0.0.1:$PGPORT/postgres"

# Never send, in any scenario: the send path mails Nikhil for real.
unset GMAIL_USER GMAIL_APP_PASSWORD || true

fail() { echo "PROVE FAILED: $*" >&2; exit 1; }

# Asserts one stage's reported status from the run's summary block.
expect() { # expect <log> <stage> <STATUS>
    grep -qE "^  $2 +$3 " "$1" || fail "expected stage '$2' to be $3; summary was:
$(sed -n '/^  preflight/,/^$/p' "$1")"
}

run_daily() { # run_daily <log> <extra env assignments...>
    local log="$1"; shift
    set +e
    env "$@" FINDS_RUN_DIR="$RUNS/$log" HN_LOOKBACK_HOURS=3 \
        node finds/run/daily.ts >"$CLUSTER/$log.log" 2>&1
    echo $? >"$CLUSTER/$log.exit"
    set -e
    cat "$CLUSTER/$log.log"
    echo "exit=$(cat "$CLUSTER/$log.exit")"
}

echo "################ A. no credential at all ################"
run_daily a
[ "$(cat "$CLUSTER/a.exit")" = 1 ] || fail "A should exit non-zero"
expect "$CLUSTER/a.log" preflight BLOCKED
expect "$CLUSTER/a.log" digest SKIPPED
grep -q "NO DIGEST WAS SENT" "$CLUSTER/a.log" || fail "A should say no digest was sent"

echo
echo "################ B. database up, SOURCE DOWN ################"
# The source is made unreachable without touching W2's module: Node's fetch is
# pointed at a proxy that refuses connections. Postgres does not go through
# fetch, so the database stays up -- which is the whole point of the test.
run_daily b DATABASE_URL="$DB_URL" NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:1
[ "$(cat "$CLUSTER/b.exit")" = 1 ] || fail "B should exit non-zero"
expect "$CLUSTER/b.log" preflight OK
expect "$CLUSTER/b.log" "ingest:hn" DOWN      # D3: reported, not fatal
expect "$CLUSTER/b.log" census DOWN           # and the empty day is loud
expect "$CLUSTER/b.log" digest BLOCKED
grep -q "SKIPPED" "$CLUSTER/b.log" && fail "B should have run every stage, not skipped any"
echo "-- and the DOWN state is durable, not just a log line:"
psql -c "SELECT slug, status, consecutive_failures, last_error FROM finds_source_health;"
[ "$(psql -tAc "SELECT status FROM finds_source_health WHERE slug='hn'")" = down ] \
    || fail "B should have recorded source hn as down in finds_sources"

echo
echo "################ C. database up, source up ################"
run_daily c DATABASE_URL="$DB_URL"
[ "$(cat "$CLUSTER/c.exit")" = 1 ] || fail "C should still exit non-zero -- no digest was sent"
expect "$CLUSTER/c.log" preflight OK
expect "$CLUSTER/c.log" "ingest:hn" OK
expect "$CLUSTER/c.log" census OK
expect "$CLUSTER/c.log" verify MISSING
expect "$CLUSTER/c.log" select MISSING
expect "$CLUSTER/c.log" digest BLOCKED
echo "-- real rows landed, and the source recovered:"
psql -c "SELECT slug, status, consecutive_failures FROM finds_source_health;"
psql -c "SELECT COUNT(*) AS candidates FROM finds_candidates;
         SELECT COUNT(*) AS sightings FROM finds_candidate_sightings;"
psql -c "SELECT name, product_url FROM finds_candidates ORDER BY first_seen_at LIMIT 5;"
[ "$(psql -tAc "SELECT COUNT(*) FROM finds_candidates")" -gt 0 ] || fail "C ingested nothing"

echo
echo "################ D. the comment path can never be scheduled ################"
node --input-type=module -e "
import { assertNoCommentPath } from './finds/run/pipeline.ts';
try {
  assertNoCommentPath([{ id: 'oops', what: 'x', owner: 'W9', onFailure: 'continue',
    command: { args: ['finds/comment/postComment.ts'], timeoutMs: 1 } }]);
  console.error('FAIL: the runner accepted a comment stage'); process.exit(1);
} catch (e) { console.log('refused, correctly: ' + e.message); }
"

echo
echo "ALL SCENARIOS BEHAVED AS ASSERTED."
