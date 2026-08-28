import { getPool } from './db.ts';
import { ensureSource, recordFailure, recordSuccess } from './health.ts';
import { upsertCandidate, upsertSighting } from './ingest.ts';
import { fetchUneedLaunches } from './uneed.ts';

// Daily Uneed ingest. Usage: DATABASE_URL=... node finds/sources/run-uneed.ts
//
// One call gets the whole daily surface: `limit` is capped at 50 by the API
// (R1 §5.2) and there is no pagination, so there is nothing to window by
// time -- the sighting upsert's (source_id, external_id) uniqueness is what
// keeps re-running this idempotent.

const pool = getPool();
const sourceId = await ensureSource(pool, {
  slug: 'uneed',
  displayName: 'Uneed',
  homepageUrl: 'https://www.uneed.best',
  authKind: 'none',
});

try {
  const launches = await fetchUneedLaunches();
  console.log(`[uneed] fetched ${launches.length} launch(es) with a product URL`);

  let newSightings = 0;
  for (const launch of launches) {
    const candidateId = await upsertCandidate(pool, {
      product_url: launch.productUrl,
      name: launch.name,
      tagline: launch.tagline,
    });
    const isNew = await upsertSighting(pool, {
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
  await recordSuccess(pool, sourceId);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await recordFailure(pool, sourceId, message);
  console.error(`[uneed] FAILED: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
