import { fetchUneedLaunches } from './uneed.ts';

// Daily Uneed ingest. Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node finds/sources/run-uneed.ts
// Dry run (fetch only, never touches the database): node finds/sources/run-uneed.ts --dry
//
// One call gets the whole daily surface: `limit` is capped at 50 by the API
// (R1 §5.2) and there is no pagination, so there is nothing to window by
// time -- the sighting upsert's (source_id, external_id) uniqueness is what
// keeps re-running this idempotent.

const DRY = process.argv.includes('--dry');

const launches = await fetchUneedLaunches();
console.log(`[uneed] fetched ${launches.length} launch(es) with a product URL`);

if (DRY) {
  // See run-hn.ts: db.ts/health.ts/ingest.ts are never imported in dry mode,
  // so there is structurally no credential read and no write possible here.
  for (const launch of launches) {
    console.log(`[uneed] [DRY] ${launch.name} -- ${launch.productUrl} (${launch.sourceUrl})`);
  }
  console.log(`[uneed] [DRY RUN -- FETCH ONLY, NOT PERSISTED] ${launches.length} launch(es), nothing written`);
  process.exit(0);
}

const { getSupabaseClient } = await import('./db.ts');
const { ensureSource, recordFailure, recordSuccess } = await import('./health.ts');
const { upsertCandidate, upsertSighting } = await import('./ingest.ts');

const client = getSupabaseClient();
const sourceId = await ensureSource(client, {
  slug: 'uneed',
  displayName: 'Uneed',
  homepageUrl: 'https://www.uneed.best',
  authKind: 'none',
});

try {
  let newSightings = 0;
  for (const launch of launches) {
    const candidateId = await upsertCandidate(client, {
      product_url: launch.productUrl,
      name: launch.name,
      tagline: launch.tagline,
    });
    const isNew = await upsertSighting(client, {
      candidate_id: candidateId,
      source_id: sourceId,
      external_id: launch.externalId,
      source_url: launch.sourceUrl,
      title: launch.title,
      author_handle: launch.authorHandle,
      posted_at: launch.postedAt,
      raw: launch.raw,
    });
    if (isNew) {
      newSightings += 1;
      console.log(`[uneed] + ${launch.name} -- ${launch.productUrl} (${launch.sourceUrl})`);
    }
  }

  console.log(`[uneed] ${newSightings} new sighting(s), ${launches.length - newSightings} already seen`);
  await recordSuccess(client, sourceId);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await recordFailure(client, sourceId, message);
  console.error(`[uneed] FAILED: ${message}`);
  process.exitCode = 1;
}
