/**
 * The first stage of the daily run, and the reason the rest of the run can
 * be read honestly.
 *
 * DECISIONS D3 says a source that is down must be reported DOWN and the run
 * must carry on. That is only a safe rule if "the source is down" and "the
 * database is down" are distinguishable -- otherwise an unreachable Postgres
 * makes every connector fail at once, each one gets recorded as a dead
 * source, and the run reports four DOWN sources when the real answer is one
 * dead database. This stage removes the ambiguity by proving the database is
 * reachable and migrated BEFORE any connector runs. If it fails, the run
 * aborts. If it passes, a connector failure afterwards is genuinely the
 * source's failure and D3 applies.
 *
 * It also prints finds_source_health, which is where D3's honesty actually
 * lives: the run log names every source the pipeline knows about and whether
 * it is ok / stale / down / disabled, and it reads that status from the view
 * rather than recomputing it (DEPENDENCIES.md, finds_sources note).
 *
 * Usage: DATABASE_URL=... node finds/run/preflight.ts
 */

import { getPool } from '../sources/db.ts';

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
  last_success_at: Date | null;
  consecutive_failures: number;
  last_error: string | null;
}

// getPool() throws with its own message when DATABASE_URL is unset, which is
// the loud stop we want -- do not soften it.
const pool = getPool();

try {
  const { rows: ping } = await pool.query<{ now: Date }>('SELECT NOW() AS now');
  console.log(`[preflight] postgres reachable, server time ${ping[0].now.toISOString()}`);

  const { rows: present } = await pool.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'v', 'm')
        AND c.relname = ANY($1::text[])`,
    [REQUIRED_RELATIONS],
  );
  const found = new Set(present.map((r) => r.relname));
  const missing = REQUIRED_RELATIONS.filter((r) => !found.has(r));

  if (missing.length > 0) {
    console.error(
      `[preflight] FAILED: ${missing.length} of ${REQUIRED_RELATIONS.length} required ` +
        `relations are absent from this database:\n  ${missing.join('\n  ')}\n` +
        '[preflight] Apply supabase/migrations/ to this database and re-run. ' +
        'This is a hard stop: the connectors would otherwise write rows and ' +
        'fail much later at a table nobody created.',
    );
    process.exitCode = 1;
  } else {
    console.log(`[preflight] all ${REQUIRED_RELATIONS.length} required relations present`);

    // D3 visibility. Printed even when everything is fine, because "which
    // sources are we actually getting data from" is the question the daily
    // log exists to answer.
    const { rows: health } = await pool.query<HealthRow>(
      `SELECT slug, status, last_success_at, consecutive_failures, last_error
         FROM finds_source_health ORDER BY slug`,
    );
    if (health.length === 0) {
      console.log('[preflight] no sources registered yet -- a connector registers itself on its first run');
    } else {
      for (const h of health) {
        const last = h.last_success_at ? h.last_success_at.toISOString() : 'never';
        const err = h.status === 'ok' ? '' : `  last_error=${h.last_error ?? 'none'}`;
        console.log(
          `[preflight] source ${h.slug}: ${h.status}  last_success=${last} ` +
            `consecutive_failures=${h.consecutive_failures}${err}`,
        );
      }
    }
  }
} catch (err) {
  console.error(`[preflight] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
