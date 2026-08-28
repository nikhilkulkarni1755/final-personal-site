#!/usr/bin/env bash
# Runs the REAL finds/run/daily.ts and shows what it does. Nothing is mocked
# here and nothing is sent.
#
# WHAT THIS CAN AND CANNOT PROVE, stated plainly.
#
# D19 moved the pipeline onto one Supabase service-role credential (D17), which
# means every database stage now speaks PostgREST rather than raw Postgres. The
# previous version of this script span up a throwaway local Postgres cluster and
# pointed DATABASE_URL at it -- that no longer proves anything, because no stage
# reads DATABASE_URL any more and there is no local PostgREST to put in front of
# a local cluster. Keeping the cluster would have been theatre.
#
# So the split is:
#   * the RUNNER's failure policy -- abort vs continue, blocked, missing, and
#     the no-fake-green artifact check -- is proven by finds/run/pipeline.test.ts
#     with real subprocesses and no credentials at all. That is where the D3
#     "a source dying does not stop the run, a datastore dying does" guarantee
#     is actually tested. Run it: node --test finds/run/pipeline.test.ts
#   * THIS script proves the credential paths end to end against whatever
#     credentials really exist in the environment.
#
# NOT PROVEN, and it should stay visible until it is: the datastore-up path.
# No SUPABASE_SERVICE_ROLE_KEY exists anywhere yet (repo secrets are empty and
# .env carries only the public anon key), so nothing here can show a green
# preflight followed by a real ingest. That is a missing credential, not a
# missing test, and it is the top item on the coordinator's list for Nikhil.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Never send, in any scenario: the send path mails Nikhil for real.
unset GMAIL_USER GMAIL_APP_PASSWORD || true

fail() { echo "PROVE FAILED: $*" >&2; exit 1; }

# Asserts one stage's reported status from the run's summary block.
expect() { # expect <log> <stage> <STATUS>
    grep -qE "^  $2 +$3 " "$1" || fail "expected stage '$2' to be $3; summary was:
$(sed -n '/^  preflight/,/^$/p' "$1")"
}

LOGS="$(mktemp -d "${TMPDIR:-/tmp}/finds-run-prove.XXXXXX")"
trap 'rm -rf "$LOGS"' EXIT

echo "################ A. no credential at all ################"
env -u SUPABASE_URL -u VITE_SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY \
    FINDS_RUN_DIR="$LOGS/a" node finds/run/daily.ts >"$LOGS/a.log" 2>&1
echo "exit=$?" | tee -a "$LOGS/a.log"
cat "$LOGS/a.log"
expect "$LOGS/a.log" preflight BLOCKED
expect "$LOGS/a.log" "ingest:uneed" SKIPPED
expect "$LOGS/a.log" digest SKIPPED
grep -q "NO DIGEST WAS SENT" "$LOGS/a.log" || fail "A should say no digest was sent"
grep -qE "^exit=1$" "$LOGS/a.log" || fail "A should exit non-zero"
echo "--> preflight BLOCKED on the credential NAME; no value printed anywhere."

echo
echo "################ B. real project, INSUFFICIENT credential ################"
# Uses whatever is already in the environment. Export the site's public anon
# key as SUPABASE_SERVICE_ROLE_KEY to run this: it is a real key against the
# real project, it is already public in the browser bundle, and it is exactly
# the wrong key for the pipeline -- which is the point. preflight does only
# HEAD reads, so this writes nothing.
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}" ]; then
    echo "SKIPPED: no SUPABASE_URL + key in the environment to test against."
    echo "         Run with a real URL and the PUBLIC anon key to see this path."
else
    FINDS_RUN_DIR="$LOGS/b" node finds/run/daily.ts >"$LOGS/b.log" 2>&1
    echo "exit=$?" | tee -a "$LOGS/b.log"
    cat "$LOGS/b.log"
    expect "$LOGS/b.log" preflight FAILED
    expect "$LOGS/b.log" digest SKIPPED
    grep -q "permission denied" "$LOGS/b.log" \
        || fail "B should name permission denied, not just 'failed'"
    echo "--> preflight reached the real project, was refused, and said WHICH"
    echo "    kind of refusal -- 'wrong credential', not 'migrations missing'."
fi

echo
echo "ALL AVAILABLE SCENARIOS BEHAVED AS ASSERTED."
echo "Reminder: the datastore-UP path is still unproven -- no service-role key exists."
