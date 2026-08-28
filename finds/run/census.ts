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
 * not as a quiet zero. Uneed alone returns >=50/day and Show HN ~134/day
 * (R1), so an empty day is a fault until proven otherwise. The stage is
 * non-aborting: the rest of the run still reports its own state.
 *
 * D19: reads through the shared Supabase service-role client (D17), the same
 * access path the connectors just wrote through. One HEAD count per source --
 * no rows come back, only the count.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node finds/run/census.ts [lookback-hours]
 */

import { getSupabaseClient } from '../sources/db.ts';

const LOOKBACK_HOURS = Number(process.argv[2] ?? process.env.FINDS_CENSUS_HOURS ?? 24);
const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();

const client = getSupabaseClient();

const { data: sources, error: sourcesError } = await client
  .from('finds_sources')
  .select('id, slug')
  .order('slug');

if (sourcesError) {
  console.error(`[census] FAILED: could not read finds_sources: ${sourcesError.message}`);
  process.exitCode = 1;
} else if (!sources || sources.length === 0) {
  console.error(
    '[census] FAILED: no sources are registered at all. A connector registers ' +
      'itself on its first successful run, so this means not one of them got that far.',
  );
  process.exitCode = 1;
} else {
  let total = 0;
  let failed = false;

  for (const source of sources as { id: string; slug: string }[]) {
    const { count, error } = await client
      .from('finds_candidate_sightings')
      .select('*', { head: true, count: 'exact' })
      .eq('source_id', source.id)
      .gte('seen_at', since);

    if (error) {
      console.error(`[census] FAILED: counting ${source.slug}: ${error.message}`);
      failed = true;
      continue;
    }
    console.log(`[census] ${source.slug}: ${count ?? 0} sighting(s) in the last ${LOOKBACK_HOURS}h`);
    total += count ?? 0;
  }

  if (failed) {
    process.exitCode = 1;
  } else if (total === 0) {
    console.error(
      `[census] FAILED: 0 new sightings in the last ${LOOKBACK_HOURS}h across all ` +
        `${sources.length} registered source(s). Nothing was ingested, so there is ` +
        'nothing for the rest of the pipeline to work on. Check the per-source status ' +
        'printed by preflight: a source reporting "ok" while landing zero rows means ' +
        'the connector ran fine and the source returned nothing, which is a connector ' +
        'or an upstream-API change, not a quiet day.',
    );
    process.exitCode = 1;
  } else {
    console.log(`[census] ${total} sighting(s) landed in the last ${LOOKBACK_HOURS}h`);
  }
}
