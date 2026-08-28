import { getPool } from './db.ts';
import { ensureSource, recordFailure, recordSuccess } from './health.ts';
import { upsertCandidate, upsertSighting } from './ingest.ts';
import { fetchNewGithubRepos } from './github.ts';

// Daily GitHub ingest. Usage: GITHUB_TOKEN=... DATABASE_URL=... node finds/sources/run-github.ts
//
// `created:>=` is day-granular (GitHub has no time-of-day filter), so the
// window is "yesterday and today" -- a day of overlap against a missed cron
// run, same rationale as HN's lookback. The sighting upsert's
// (source_id, external_id) uniqueness absorbs the overlap.

const GITHUB_LOOKBACK_DAYS = Number(process.env.GITHUB_LOOKBACK_DAYS ?? 1);

const pool = getPool();
const sourceId = await ensureSource(pool, {
  slug: 'github',
  displayName: 'GitHub',
  homepageUrl: 'https://github.com',
  authKind: 'api_key',
});

try {
  const since = new Date(Date.now() - GITHUB_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const launches = await fetchNewGithubRepos(since);
  console.log(`[github] fetched ${launches.length} repo(s) created on/after ${since.toISOString().slice(0, 10)}`);

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
      console.log(`[github] + ${launch.name} -- ${launch.productUrl} (${launch.sourceUrl})`);
    }
  }

  console.log(`[github] ${newSightings} new sighting(s), ${launches.length - newSightings} already seen`);
  await recordSuccess(pool, sourceId);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await recordFailure(pool, sourceId, message);
  console.error(`[github] FAILED: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
