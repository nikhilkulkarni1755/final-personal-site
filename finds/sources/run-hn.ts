import { getSupabaseClient } from './db.ts';
import { ensureSource, recordFailure, recordSuccess } from './health.ts';
import { upsertCandidate, upsertSighting } from './ingest.ts';
import { fetchShowHN } from './hn.ts';

// Daily Show HN ingest. Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node finds/sources/run-hn.ts
//
// Window: everything created in the last HN_LOOKBACK_HOURS (default 26 --
// a day plus slack for cron drift). The sighting upsert is idempotent
// ((source_id, external_id) UNIQUE), so overlap between runs costs nothing;
// it exists so a missed cron run does not lose a day of launches.

const LOOKBACK_HOURS = Number(process.env.HN_LOOKBACK_HOURS ?? 26);

const client = getSupabaseClient();
const sourceId = await ensureSource(client, {
  slug: 'hn',
  displayName: 'Hacker News / Show HN',
  homepageUrl: 'https://news.ycombinator.com',
  authKind: 'none',
});

try {
  const sinceUnixSeconds = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
  const launches = await fetchShowHN(sinceUnixSeconds);
  console.log(
    `[hn] fetched ${launches.length} Show HN post(s) with a product URL, ` +
      `created after ${new Date(sinceUnixSeconds * 1000).toISOString()}`,
  );

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
      console.log(`[hn] + ${launch.name} -- ${launch.productUrl} (${launch.sourceUrl})`);
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
