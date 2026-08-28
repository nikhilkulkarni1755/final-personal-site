#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres cluster and run the schema
# assertions against it.
#
# This exists because the schema makes claims that are only worth anything if
# they are enforced -- cross-source dedupe, the D3 down/stale/ok distinction,
# and the rule that anon can read nothing but published finds. A comment
# asserting those is not evidence. This is.
#
# Needs a local Postgres (initdb/pg_ctl/psql on PATH). Touches no real database
# and creates no files inside the repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLUSTER="$(mktemp -d "${TMPDIR:-/tmp}/finds-schema-test.XXXXXX")"
trap 'pg_ctl -D "$CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$CLUSTER"' EXIT

initdb -D "$CLUSTER/data" -U postgres --auth=trust >"$CLUSTER/initdb.log" 2>&1
mkdir -p "$CLUSTER/sock"
pg_ctl -D "$CLUSTER/data" -o "-k $CLUSTER/sock -c listen_addresses=''" \
       -l "$CLUSTER/pg.log" -w start >/dev/null

psql() { command psql -h "$CLUSTER/sock" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

# The Supabase roles the RLS posture is written against. service_role bypasses
# RLS; anon and authenticated do not.
psql -c "CREATE ROLE anon;
         CREATE ROLE authenticated;
         CREATE ROLE service_role BYPASSRLS;
         GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
         ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT ALL ON TABLES TO anon, authenticated, service_role;"

for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
    psql -f "$migration" >/dev/null
done

psql -f "$REPO_ROOT/finds/db/schema.test.sql"

# The security boundary: the anon key is in the browser, so anything anon can
# read is public. Assert the private tables refuse it.
for table in finds_sources finds_source_health finds_candidates \
             finds_candidate_sightings finds_evidence finds_verdicts \
             finds_verdict_evidence finds_digests finds_digest_items \
             finds_undigested_candidates finds_crawl_verdicts \
             finds_crawl_evidence; do
    if psql -c "SET ROLE anon; SELECT 1 FROM $table LIMIT 1;" >/dev/null 2>&1; then
        echo "FAIL: anon can read $table" >&2
        exit 1
    fi
done
echo "anon is denied on every private table"

# PostgREST exposes every function in the schema as a callable endpoint, and
# finds_write_verdict writes. Only the service role may execute it.
for role in anon authenticated; do
    if [ "$(psql -tAc "SELECT has_function_privilege('$role', 'finds_write_verdict(uuid,uuid,text,jsonb)', 'EXECUTE');")" = "t" ]; then
        echo "FAIL: $role can execute finds_write_verdict" >&2
        exit 1
    fi
done
if [ "$(psql -tAc "SELECT has_function_privilege('service_role', 'finds_write_verdict(uuid,uuid,text,jsonb)', 'EXECUTE');")" != "t" ]; then
    echo "FAIL: service_role cannot execute finds_write_verdict" >&2
    exit 1
fi
echo "finds_write_verdict is service-role only"

# ...and finds_published is the one table it CAN read.
psql -c "SET ROLE anon; SELECT 1 FROM finds_published LIMIT 1;" >/dev/null
echo "anon can read finds_published"
