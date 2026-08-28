/**
 * The first stage of the daily run, and the reason the rest of the run can
 * be read honestly.
 *
 * DECISIONS D3 says a source that is down must be reported DOWN and the run
 * must carry on. That is only a safe rule if "the source is down" and "the
 * datastore is down" are distinguishable -- otherwise an unreachable
 * Supabase makes every connector fail at once, each one records itself as a
 * dead source, and the run reports four DOWN sources when the real answer is
 * one dead datastore. This stage removes the ambiguity by proving the
 * datastore is reachable, migrated, and readable with the credential we
 * actually hold, BEFORE any connector runs. If it fails, the run aborts. If
 * it passes, a connector failure afterwards is genuinely the source's
 * failure and D3 applies.
 *
 * D19: it goes through getSupabaseClient() -- the same SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY client every other lane uses (D17). An earlier
 * version of this file opened its own `pg` pool on a DATABASE_URL, which
 * would have made Nikhil provision a second database credential for a check
 * that needs no extra access. It also exercised a connection path no real
 * stage uses, which is the wrong thing for a preflight to do: this one now
 * fails exactly where the pipeline would fail.
 *
 * The check is a HEAD select per relation -- no rows, no columns, no data
 * transferred, 13 cheap round trips once a day.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node finds/run/preflight.ts
 */

import { getSupabaseClient } from '../sources/db.ts';

// Every relation the pipeline reads or writes. A partially applied migration
// set is the silent-failure case this exists to make loud: the connectors
// would run, write candidates, and only fail much later at a table nobody
// created.
const REQUIRED_RELATIONS = [
  'finds_sources',
  'finds_source_health',
  'finds_candidates',
  'finds_candidate_sightings',
  'finds_crawl_verdicts',
  'finds_crawl_evidence',
  'finds_evidence',
  'finds_verdicts',
  'finds_verdict_evidence',
  'finds_digests',
  'finds_digest_items',
  'finds_undigested_candidates',
  'finds_published',
];

interface HealthRow {
  slug: string;
  status: string;
  last_success_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
}

/**
 * Why a relation could not be read. The distinction matters operationally:
 * "the migrations are not applied" and "this credential is not allowed to
 * read them" have completely different fixes, and a preflight that reports
 * only "failed" sends whoever is on the other end looking in the wrong
 * place. PostgREST surfaces both as an error on the same call.
 */
function classify(code: string | undefined, message: string): string {
  if (code === '42P01' || code === 'PGRST205') return 'relation does not exist -- migrations not applied';
  if (code === '42501') return 'permission denied -- this credential cannot read it (service-role key required)';
  return `${code ?? 'error'}: ${message}`;
}

// getSupabaseClient() throws with its own message when the credential is
// absent, which is the loud stop we want -- do not soften it.
const client = getSupabaseClient();

const problems: string[] = [];

for (const relation of REQUIRED_RELATIONS) {
  // head: true asks PostgREST for the row count only -- no columns, no rows,
  // no body. The cheapest possible "can I read this at all".
  const { error } = await client.from(relation).select('*', { head: true }).limit(0);
  if (error) problems.push(`  ${relation}: ${classify(error.code, error.message)}`);
}

if (problems.length > 0) {
  console.error(
    `[preflight] FAILED: ${problems.length} of ${REQUIRED_RELATIONS.length} required ` +
      `relations are not readable:\n${problems.join('\n')}\n` +
      '[preflight] This is a hard stop. The connectors would otherwise run, write ' +
      'rows, and fail much later against a relation nobody created -- or worse, ' +
      'appear to work while writing nothing.',
  );
  process.exitCode = 1;
} else {
  console.log(`[preflight] supabase reachable; all ${REQUIRED_RELATIONS.length} required relations readable`);

  // D3 visibility. Printed even when everything is fine, because "which
  // sources are we actually getting data from" is the question the daily
  // log exists to answer. Status is READ from the view, never recomputed
  // here (DEPENDENCIES.md, finds_sources note).
  const { data, error } = await client
    .from('finds_source_health')
    .select('slug, status, last_success_at, consecutive_failures, last_error')
    .order('slug');

  if (error) {
    console.error(`[preflight] FAILED: could not read finds_source_health: ${error.message}`);
    process.exitCode = 1;
  } else if (!data || data.length === 0) {
    console.log('[preflight] no sources registered yet -- a connector registers itself on its first run');
  } else {
    for (const h of data as HealthRow[]) {
      const last = h.last_success_at ?? 'never';
      const err = h.status === 'ok' ? '' : `  last_error=${h.last_error ?? 'none'}`;
      console.log(
        `[preflight] source ${h.slug}: ${h.status}  last_success=${last} ` +
          `consecutive_failures=${h.consecutive_failures}${err}`,
      );
    }
  }
}
