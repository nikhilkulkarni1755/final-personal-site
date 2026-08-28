import type { FetchedLaunch } from './connector.ts';
import { classifyProductUrl } from './hostClassifier.ts';

// Uneed's public launches feed. Per R1 §5.2: no auth at all, no browser, the
// site's own llms.txt invites agent use of this exact endpoint, and one
// record already carries everything our schema wants (name, tagline, url,
// launch date, even open_source/repo_url for C4). R1 calls this "the best
// find in this whole document" and recommends shipping it first.
//
// `limit` is capped at 50 by the API itself (a clean 400, not a silent
// clamp) and there is no `offset`, so one call is the whole daily surface;
// R1 measured all 50 results landing on the same `launch_date` (the ceiling
// is hit inside a single day), so this is a floor on volume, not the total.

const UNEED_LAUNCHES_URL = 'https://mcp.uneed.best/v1/launches';

interface UneedLaunch {
  name: string;
  slug: string;
  description: string | null;
  url: string | null;
  uneed_url: string;
  launch_date: string; // YYYY-MM-DD
  created_at: string;
  [key: string]: unknown;
}

interface UneedLaunchesResponse {
  launches?: UneedLaunch[];
  data?: UneedLaunch[];
}

export async function fetchUneedLaunches(): Promise<FetchedLaunch[]> {
  const res = await fetch(`${UNEED_LAUNCHES_URL}?limit=50`);
  if (!res.ok) {
    throw new Error(`Uneed /v1/launches failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as UneedLaunchesResponse | UneedLaunch[];
  const items = Array.isArray(body) ? body : (body.launches ?? body.data ?? []);

  const launches: FetchedLaunch[] = [];
  for (const item of items) {
    if (!item.url) continue; // no product site to crawl -- not a candidate
    launches.push({
      externalId: item.slug,
      sourceUrl: item.uneed_url,
      productUrl: item.url,
      productUrlKind: classifyProductUrl(item.url),
      name: item.name,
      tagline: item.description?.trim() || null,
      title: item.name,
      authorHandle: null, // no single maker handle in this record; social links only
      postedAt: `${item.launch_date}T00:00:00.000Z`,
      raw: item,
    });
  }
  return launches;
}
