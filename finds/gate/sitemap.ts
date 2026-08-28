// sitemap.xml / sitemap-index enumerator.
//
// Regex-based extraction of <loc> values rather than a full XML parser: a
// sitemap is a flat, well-known shape (urlset > url > loc, or
// sitemapindex > sitemap > loc) and we only ever need that one field, so a
// real XML parser dependency isn't justified (see lane brief: prefer zero
// new deps for parsing).
//
// Some sites (e.g. Product Hunt) publish gzip-compressed sitemaps
// (sitemap.xml.gz). We decompress with node:zlib, which ships with Node --
// not a new dependency.

import { gunzipSync } from 'node:zlib';
import { GATE_CONFIG } from './config.ts';

const LOC_RE = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map((m) => m[1].trim());
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

interface FetchedSitemap {
  fetched: boolean;
  status: number | null;
  isIndex: boolean;
  locs: string[];
}

async function fetchOneSitemap(url: string): Promise<FetchedSitemap> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATE_CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': GATE_CONFIG.userAgent },
    });
    if (!(res.status >= 200 && res.status < 300)) {
      return { fetched: false, status: res.status, isIndex: false, locs: [] };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const isGzip = url.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b);
    const xml = (isGzip ? gunzipSync(buf) : buf).toString('utf-8');
    return { fetched: true, status: res.status, isIndex: isSitemapIndex(xml), locs: extractLocs(xml) };
  } catch {
    return { fetched: false, status: null, isIndex: false, locs: [] };
  } finally {
    clearTimeout(timer);
  }
}

export interface SitemapEnumeration {
  /** Page URLs found across all leaf sitemaps, capped by config. */
  pageUrls: string[];
  /** Every sitemap URL (index and leaf) actually fetched. */
  sitemapsFetched: string[];
  /** True if any fetch was truncated by a config cap rather than exhausted. */
  truncated: boolean;
}

/**
 * Walk a sitemap or sitemap-index starting at `rootUrls`, returning the
 * union of page URLs found. Bounded by config.maxSitemapsPerSite (total
 * sitemap documents fetched) and config.maxUrlsPerSitemap (per document).
 */
export async function enumerateSitemaps(rootUrls: string[]): Promise<SitemapEnumeration> {
  const pageUrls: string[] = [];
  const sitemapsFetched: string[] = [];
  const seen = new Set<string>();
  const queue = [...rootUrls];
  let truncated = false;

  while (queue.length > 0 && sitemapsFetched.length < GATE_CONFIG.maxSitemapsPerSite) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const result = await fetchOneSitemap(url);
    if (!result.fetched) continue;
    sitemapsFetched.push(url);

    if (result.isIndex) {
      queue.push(...result.locs);
      continue;
    }

    const capped = result.locs.slice(0, GATE_CONFIG.maxUrlsPerSitemap);
    if (capped.length < result.locs.length) truncated = true;
    pageUrls.push(...capped);
  }

  if (queue.length > 0) truncated = true;

  return { pageUrls, sitemapsFetched, truncated };
}
