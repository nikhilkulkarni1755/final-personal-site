/**
 * Supply check, run straight after ingest.
 *
 * A connector can exit 0 having found nothing at all -- an API that changed
 * shape, a search window that no longer matches, a source that quietly
 * started returning an empty list. Every one of those looks like a healthy
 * run from the outside, and the first symptom would be Nikhil noticing the
 * emails got thin. So the run counts what it actually landed and says so.
 *
 * Zero new sightings in the window is reported as a FAILURE of this stage,
 * not as a quiet zero. Show HN alone carries ~134 launches/day (R1), so an
 * empty day is a fault until proven otherwise. The stage is non-aborting:
 * the rest of the run still reports its own state.
 *
 * Usage: DATABASE_URL=... node finds/run/census.ts [lookback-hours]
 */

import { getPool } from '../sources/db.ts';

const LOOKBACK_HOURS = Number(process.argv[2] ?? process.env.FINDS_CENSUS_HOURS ?? 24);

const pool = getPool();

try {
  const { rows } = await pool.query<{ slug: string; sightings: string; candidates: string }>(
    `SELECT s.slug,
            COUNT(*)::text                         AS sightings,
            COUNT(DISTINCT s2.candidate_id)::text  AS candidates
       FROM finds_candidate_sightings s2
       JOIN finds_sources s ON s.id = s2.source_id
      WHERE s2.seen_at > NOW() - make_interval(hours => $1::int)
      GROUP BY s.slug
      ORDER BY s.slug`,
    [LOOKBACK_HOURS],
  );

  const total = rows.reduce((n, r) => n + Number(r.sightings), 0);
  for (const r of rows) {
    console.log(`[census] ${r.slug}: ${r.sightings} sighting(s), ${r.candidates} distinct product(s)`);
  }

  if (total === 0) {
    console.error(
      `[census] FAILED: 0 new sightings in the last ${LOOKBACK_HOURS}h across all sources. ` +
        'Nothing was ingested, so there is nothing for the rest of the pipeline to ' +
        'work on. Check the per-source status printed by preflight: a source ' +
        'reporting "ok" while landing zero rows means the connector ran fine and ' +
        'the source returned nothing, which is a connector or an upstream-API ' +
        'change, not a quiet day.',
    );
    process.exitCode = 1;
  } else {
    console.log(`[census] ${total} sighting(s) landed in the last ${LOOKBACK_HOURS}h`);
  }
} catch (err) {
  console.error(`[census] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
