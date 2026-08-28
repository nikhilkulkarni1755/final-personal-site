import type { Page } from 'playwright';
import type { FetchedLaunch } from './connector.ts';
import { classifyProductUrl } from './hostClassifier.ts';

// Peerlist Launchpad. Per R1 sec.1: no public API, and every plain HTTP
// request to peerlist.io (curl, fetch) gets a Cloudflare managed-challenge
// 403 -- real headless Chromium is required to pass it. The launch data
// itself needs no credential (D3-AMENDED): the internal API is read out of
// the client bundle and confirmed anonymous.
//
// A real desktop Chrome UA is required -- Playwright's own default UA did
// not pass the challenge in testing, an explicit one did. This is not UA
// forgery to evade a stated policy: peerlist.io/robots.txt is
// `User-Agent: * / Allow: /` and R1's read of the ToS found no anti-bot
// clause at all (sec.1.9). The challenge is a technical control, not a
// policy one, and this is the documented working pattern.
export const PEERLIST_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * Navigate to a cheap same-origin page before any API call. R1 measured a
 * ~12-call-per-context Cloudflare burst budget that an app page (which fires
 * its own XHRs) spends before a connector gets to use it; /robots.txt does
 * not.
 */
export async function primeCloudflareClearance(page: Page): Promise<void> {
  await page.goto('https://peerlist.io/robots.txt');
}

/**
 * UTC ISO 8601 week (Monday-start, week 1 contains the year's first
 * Thursday) -- verified against R1's measured data points: 2026-08-24 ->
 * week 35, 2026-08-17 -> week 34, matching Peerlist's own `year`/`week`
 * query params exactly. Peerlist computes this in UTC, not local time.
 */
export function getUTCISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: d.getUTCFullYear(), week };
}

interface PeerlistCreatedBy {
  profileHandle: string;
}

/** One `data.spotlight[]` element -- the list record. No `url` or `description` (R1 sec.1.5). */
export interface PeerlistListItem {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  projectURL: string;
  featuredOn: string;
  createdBy: PeerlistCreatedBy;
  [key: string]: unknown;
}

interface PeerlistSpotlightResponse {
  success: boolean;
  data: { spotlight: PeerlistListItem[]; cursor?: string };
}

/**
 * Pages `GET /api/v1/users/projects/spotlight` for one ISO week to
 * exhaustion. R1 sec.1.6: `count=true` is an unreliable cached number --
 * paginate and count instead, which is what this does by returning every
 * record. Paced 900ms apart per R1's sustained-without-a-challenge rate.
 */
export async function fetchPeerlistWeekListing(
  page: Page,
  year: number,
  week: number,
): Promise<PeerlistListItem[]> {
  const items: PeerlistListItem[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 10; // defensive cap; R1 measured 3 pages for a full 286-launch week

  do {
    if (pageCount > 0) await sleep(900);
    const params: Record<string, string> = { year: String(year), week: String(week), limit: '100' };
    if (cursor) params.cursor = cursor;
    const body = await evaluateJson<PeerlistSpotlightResponse>(page, '/api/v1/users/projects/spotlight', params);
    items.push(...body.data.spotlight);
    cursor = body.data.cursor;
    pageCount += 1;
  } while (cursor && pageCount < MAX_PAGES);

  return items;
}

/** `GET /api/v1/featured-launch/get-featured-today` -- the one record per day that already carries `url` and `description` (R1 sec.1.4), so it needs no detail-page hop. */
export async function fetchPeerlistFeaturedToday(page: Page): Promise<FetchedLaunch | null> {
  const body = await evaluateJson<{ success: boolean; data: { project: Record<string, unknown> } }>(
    page,
    '/api/v1/featured-launch/get-featured-today',
    {},
  );
  const project = body.data?.project;
  const rawUrl = typeof project?.url === 'string' ? project.url : '';
  if (!project || !rawUrl) return null; // no product site to crawl -- not a candidate
  const url = withScheme(rawUrl);

  return {
    externalId: String(project.id),
    sourceUrl: `https://peerlist.io${String(project.projectURL)}`,
    productUrl: url,
    productUrlKind: classifyProductUrl(url),
    name: String(project.title),
    tagline: typeof project.tagline === 'string' ? project.tagline : null,
    title: String(project.title),
    authorHandle: (project.createdBy as PeerlistCreatedBy | undefined)?.profileHandle ?? null,
    postedAt: typeof project.featuredOn === 'string' ? project.featuredOn : null,
    raw: project,
  };
}

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

/**
 * The one expensive step in this connector: fetches the project's detail
 * page HTML and parses `__NEXT_DATA__` for the fields the list record lacks
 * (R1 sec.1.5b). Returns null if the page has no `__NEXT_DATA__`/no `url` --
 * caller must not synthesise a product URL from the listing page (D6).
 *
 * Deliberately an in-page `fetch()` of the raw HTML, not `page.goto()`.
 * `goto` renders the page, which fires the same kind of XHR/subresource
 * burst R1 measured for the SPA (sec.1.3) and spends the Cloudflare budget
 * in a handful of navigations. `fetch` from inside the already-cleared page
 * costs exactly one request, same as the list/featured calls -- measured
 * live to resolve 10 detail pages back to back with no challenge, where
 * `goto` challenged after 1.
 */
export async function resolvePeerlistDetail(
  page: Page,
  projectURL: string,
): Promise<Record<string, unknown> | null> {
  const { status, text } = await page.evaluate(async (u: string) => {
    const res = await fetch(u);
    return { status: res.status, text: await res.text() };
  }, `https://peerlist.io${projectURL}`);
  if (status !== 200) return null;

  const match = text.match(NEXT_DATA_RE);
  if (!match) return null;
  const parsed: unknown = JSON.parse(match[1]);
  const project = (parsed as { props?: { pageProps?: { project?: Record<string, unknown> } } })?.props?.pageProps
    ?.project;
  return project ?? null;
}

/** Combines a list item with its resolved detail page into a FetchedLaunch. Null if the detail page has no product URL. */
export function buildResolvedLaunch(
  item: PeerlistListItem,
  detail: Record<string, unknown>,
): FetchedLaunch | null {
  const rawUrl = typeof detail.url === 'string' ? detail.url : '';
  if (!rawUrl) return null; // no product site to crawl -- not a candidate
  const url = withScheme(rawUrl);
  return {
    externalId: item.id,
    sourceUrl: `https://peerlist.io${item.projectURL}`,
    productUrl: url,
    productUrlKind: classifyProductUrl(url),
    name: item.title,
    tagline: item.tagline,
    title: item.title,
    authorHandle: item.createdBy?.profileHandle ?? null,
    postedAt: item.featuredOn,
    raw: { list: item, detail },
  };
}

/**
 * Peerlist's `url` field is free text a maker typed into a form -- found
 * live (IndieCRM, 2026-08-28) with no scheme at all ("indiecrm.app"), which
 * is not a fetchable absolute URL for W1's gate or W4's crawler. Defaults to
 * https:// rather than dropping the candidate; this is a normalisation of
 * what was typed, not an invented fact -- the host and path are untouched.
 */
function withScheme(url: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluateJson<T>(page: Page, path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${path}?${query}` : path;
  const { status, text } = await page.evaluate(async (u: string) => {
    const res = await fetch(u);
    return { status: res.status, text: await res.text() };
  }, url);
  if (status !== 200) {
    throw new Error(`Peerlist request failed: HTTP ${status} on ${path}`);
  }
  return JSON.parse(text) as T;
}
