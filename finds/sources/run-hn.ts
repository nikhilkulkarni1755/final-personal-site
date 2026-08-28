import { fetchShowHN } from './hn.ts';
import { productUrlKindTag } from './hostClassifier.ts';

// Daily Show HN ingest. Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node finds/sources/run-hn.ts
// Dry run (fetch only, never touches the database): node finds/sources/run-hn.ts --dry
//
// Window: everything created in the last HN_LOOKBACK_HOURS (default 26 --
// a day plus slack for cron drift). The sighting upsert is idempotent
// ((source_id, external_id) UNIQUE), so overlap between runs costs nothing;
// it exists so a missed cron run does not lose a day of launches.

const LOOKBACK_HOURS = Number(process.env.HN_LOOKBACK_HOURS ?? 26);
const DRY = process.argv.includes('--dry');

const sinceUnixSeconds = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
const launches = await fetchShowHN(sinceUnixSeconds);
console.log(
  `[hn] fetched ${launches.length} Show HN post(s) with a product URL, ` +
    `created after ${new Date(sinceUnixSeconds * 1000).toISOString()}`,
);

if (DRY) {
  // Everything below this line touches the database. In dry mode we never
  // import db.ts/health.ts/ingest.ts at all, so there is no credential to
  // read and structurally no way for this run to write anything -- same
  // guarantee finds/email/dry-run.ts gives by never importing transport.ts.
  for (const launch of launches) {
    console.log(`[hn] [DRY] ${launch.name} -- ${launch.productUrl}${productUrlKindTag(launch.productUrlKind)} (${launch.sourceUrl})`);
  }
  console.log(`[hn] [DRY RUN -- FETCH ONLY, NOT PERSISTED] ${launches.length} launch(es), nothing written`);
  process.exit(0);
}

const { getSupabaseClient } = await import('./db.ts');
const { ensureSource, recordFailure, recordSuccess } = await import('./health.ts');
const { upsertCandidate, upsertSighting } = await import('./ingest.ts');

const client = getSupabaseClient();
const sourceId = await ensureSource(client, {
  slug: 'hn',
  displayName: 'Hacker News / Show HN',
  homepageUrl: 'https://news.ycombinator.com',
  authKind: 'none',
});

try {
  let newSightings = 0;
  for (const launch of launches) {
    const candidateId = await upsertCandidate(client, {
      product_url: launch.productUrl,
      name: launch.name,
      tagline: launch.tagline,
      product_url_kind: launch.productUrlKind,
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
      console.log(`[hn] + ${launch.name} -- ${launch.productUrl}${productUrlKindTag(launch.productUrlKind)} (${launch.sourceUrl})`);
    }
  }

  console.log(`[hn] ${newSightings} new sighting(s), ${launches.length - newSightings} already seen`);
  await recordSuccess(client, sourceId);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await recordFailure(client, sourceId, message);
  console.error(`[hn] FAILED: ${message}`);
  process.exitCode = 1;
}
