import { fetchNewGithubRepos } from './github.ts';
import { productUrlKindTag } from './hostClassifier.ts';

// Daily GitHub ingest. Usage:
//   GITHUB_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node finds/sources/run-github.ts
// Dry run (fetch only, never touches the database): GITHUB_TOKEN=... node finds/sources/run-github.ts --dry
//
// `created:>=` is day-granular (GitHub has no time-of-day filter), so the
// window is "yesterday and today" -- a day of overlap against a missed cron
// run, same rationale as HN's lookback. The sighting upsert's
// (source_id, external_id) uniqueness absorbs the overlap.

const GITHUB_LOOKBACK_DAYS = Number(process.env.GITHUB_LOOKBACK_DAYS ?? 1);
const DRY = process.argv.includes('--dry');

const since = new Date(Date.now() - GITHUB_LOOKBACK_DAYS * 24 * 3600 * 1000);
const launches = await fetchNewGithubRepos(since);
console.log(`[github] fetched ${launches.length} repo(s) created on/after ${since.toISOString().slice(0, 10)}`);

if (DRY) {
  // See run-hn.ts: db.ts/health.ts/ingest.ts are never imported in dry mode,
  // so there is structurally no credential read and no write possible here.
  for (const launch of launches) {
    console.log(`[github] [DRY] ${launch.name} -- ${launch.productUrl}${productUrlKindTag(launch.productUrlKind)} (${launch.sourceUrl})`);
  }
  console.log(`[github] [DRY RUN -- FETCH ONLY, NOT PERSISTED] ${launches.length} repo(s), nothing written`);
  process.exit(0);
}

const { getSupabaseClient } = await import('./db.ts');
const { ensureSource, recordFailure, recordSuccess } = await import('./health.ts');
const { upsertCandidate, upsertSighting } = await import('./ingest.ts');

const client = getSupabaseClient();
const sourceId = await ensureSource(client, {
  slug: 'github',
  displayName: 'GitHub',
  homepageUrl: 'https://github.com',
  authKind: 'api_key',
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
      console.log(`[github] + ${launch.name} -- ${launch.productUrl}${productUrlKindTag(launch.productUrlKind)} (${launch.sourceUrl})`);
    }
  }

  console.log(`[github] ${newSightings} new sighting(s), ${launches.length - newSightings} already seen`);
  await recordSuccess(client, sourceId);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await recordFailure(client, sourceId, message);
  console.error(`[github] FAILED: ${message}`);
  process.exitCode = 1;
}
