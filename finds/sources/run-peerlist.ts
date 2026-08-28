import { chromium } from 'playwright';
import type { Pool } from 'pg';
import { getPool } from './db.ts';
import { ensureSource, recordFailure, recordSuccess } from './health.ts';
import { getSeenExternalIds, upsertCandidate, upsertSighting } from './ingest.ts';
import {
  PEERLIST_CHROME_UA,
  buildResolvedLaunch,
  fetchPeerlistFeaturedToday,
  fetchPeerlistWeekListing,
  getUTCISOWeek,
  primeCloudflareClearance,
  resolvePeerlistDetail,
} from './peerlist.ts';
import type { FetchedLaunch } from './connector.ts';

// Daily Peerlist ingest. Usage: DATABASE_URL=... node finds/sources/run-peerlist.ts
//
// Engineering constraint that shapes this file (R1 sec.1.3, measured live):
// Cloudflare allows roughly 12 API calls per browser context before it
// starts challenging every request, including a repeat of a URL that just
// succeeded. The weekly Monday drop is ~286 launches, and resolving each
// one's product URL costs its own detail-page navigation (the list endpoint
// does not carry `url` -- R1 sec.1.5). Detail-hopping the whole drop in one
// run is not possible inside that budget, and burning more budget by
// hammering harder would be the opposite of the "well-behaved agent" pitch
// this whole project is built on (README, D3).
//
// So: this run resolves `get-featured-today` (free -- it already carries
// `url`, no hop needed) plus up to PEERLIST_DETAIL_HOP_LIMIT NOT-YET-SEEN
// listings per run, paced 900ms apart. Whatever is left over stays
// unresolved -- not inserted as a candidate with a fake URL (D6), not
// dropped either -- and the next day's run picks up where this one left
// off, because `getSeenExternalIds` only skips what already has a sighting
// row. A big Monday drop takes several days to fully resolve. That is a
// deliberate trade against Cloudflare's measured limit, not a bug.

const DETAIL_HOP_LIMIT = Number(process.env.PEERLIST_DETAIL_HOP_LIMIT ?? 8);
const PACE_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function persist(pool: Pool, sourceId: string, launch: FetchedLaunch): Promise<boolean> {
  const candidateId = await upsertCandidate(pool, {
    product_url: launch.productUrl,
    name: launch.name,
    tagline: launch.tagline,
  });
  return upsertSighting(pool, {
    candidate_id: candidateId,
    source_id: sourceId,
    external_id: launch.externalId,
    source_url: launch.sourceUrl,
    title: launch.title,
    author_handle: launch.authorHandle,
    posted_at: launch.postedAt,
    raw: launch.raw,
  });
}

const pool = getPool();
const sourceId = await ensureSource(pool, {
  slug: 'peerlist',
  displayName: 'Peerlist Launchpad',
  homepageUrl: 'https://peerlist.io',
  authKind: 'none',
});

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ userAgent: PEERLIST_CHROME_UA });
  const page = await context.newPage();
  await primeCloudflareClearance(page);

  let newSightings = 0;

  const featured = await fetchPeerlistFeaturedToday(page);
  if (featured) {
    const isNew = await persist(pool, sourceId, featured);
    if (isNew) {
      newSightings += 1;
      console.log(`[peerlist] + (featured today) ${featured.name} -- ${featured.productUrl} (${featured.sourceUrl})`);
    }
  } else {
    console.log('[peerlist] no featured-today launch, or it has no product URL');
  }

  await sleep(PACE_MS);
  const { year, week } = getUTCISOWeek(new Date());
  const listing = await fetchPeerlistWeekListing(page, year, week);
  console.log(`[peerlist] week ${year}-W${week}: ${listing.length} launch(es) listed`);

  const candidates = listing.filter((item) => item.id !== featured?.externalId);
  const seen = await getSeenExternalIds(pool, sourceId, candidates.map((item) => item.id));
  const unresolved = candidates.filter((item) => !seen.has(item.id));
  console.log(`[peerlist] ${unresolved.length} not yet resolved (${candidates.length - unresolved.length} already have a sighting)`);

  const toResolve = unresolved.slice(0, DETAIL_HOP_LIMIT);
  for (const item of toResolve) {
    await sleep(PACE_MS);
    const detail = await resolvePeerlistDetail(page, item.projectURL);
    if (!detail) {
      console.log(`[peerlist] skip ${item.title} -- detail page had no __NEXT_DATA__`);
      continue;
    }
    const launch = buildResolvedLaunch(item, detail);
    if (!launch) {
      console.log(`[peerlist] skip ${item.title} -- no product URL on its detail page`);
      continue;
    }
    const isNew = await persist(pool, sourceId, launch);
    if (isNew) {
      newSightings += 1;
      console.log(`[peerlist] + ${launch.name} -- ${launch.productUrl} (${launch.sourceUrl})`);
    }
  }

  if (unresolved.length > toResolve.length) {
    console.log(
      `[peerlist] ${unresolved.length - toResolve.length} launch(es) still queued -- ` +
        'Cloudflare\'s measured ~12-call burst budget means a full weekly drop resolves over several daily runs',
    );
  }

  console.log(`[peerlist] ${newSightings} new sighting(s) this run`);
  await recordSuccess(pool, sourceId);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await recordFailure(pool, sourceId, message);
  console.error(`[peerlist] FAILED: ${message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await pool.end();
}
