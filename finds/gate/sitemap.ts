// sitemap.xml / sitemap-index enumerator -- rubric §5.1/§5.2.
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
import { safeFetch } from './safeFetch.ts';
import { isSameSite } from './scope.ts';

const LOC_RE = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map((m) => m[1].trim());
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Read a response body up to maxBytes, streaming so we never buffer more
 * than the cap even for an uncompressed-length-unknown response (§5.2: 2 MB
 * per sitemap file). */
async function readBufferCapped(res: Response, maxBytes: number): Promise<{ buf: Buffer; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? { buf: buf.subarray(0, maxBytes), truncated: true } : { buf, truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { buf: Buffer.concat(chunks), truncated };
}

interface FetchedSitemap {
  fetched: boolean;
  isIndex: boolean;
  locs: string[];
  truncated: boolean;
}

async function fetchOneSitemap(url: string): Promise<FetchedSitemap> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATE_CONFIG.connectTimeoutMs);
  try {
    const res = await safeFetch(url, { signal: controller.signal });
    if (!(res.status >= 200 && res.status < 300)) {
      return { fetched: false, isIndex: false, locs: [], truncated: false };
    }
    const { buf, truncated } = await readBufferCapped(res, GATE_CONFIG.maxBytesPerSitemapFile);
    const isGzip = url.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b);
    let xml: string;
    try {
      xml = (isGzip ? gunzipSync(buf) : buf).toString('utf-8');
    } catch {
      // A byte-capped gzip stream is incomplete and won't decompress; treat
      // as not fetched rather than crash. Conservative: we just skip it.
      return { fetched: false, isIndex: false, locs: [], truncated: true };
    }
    return { fetched: true, isIndex: isSitemapIndex(xml), locs: extractLocs(xml), truncated };
  } catch {
    return { fetched: false, isIndex: false, locs: [], truncated: false };
  } finally {
    clearTimeout(timer);
  }
}

export interface SitemapEnumeration {
  /** Page URLs found across all leaf sitemaps, on the candidate's own site. */
  pageUrls: string[];
  /** Every sitemap URL (index and leaf) actually fetched. */
  sitemapsFetched: string[];
  /** True if any fetch was truncated or dropped by a config cap. */
  truncated: boolean;
}

function filterAndCap(locs: string[], candidateOrigin: string): { kept: string[]; droppedAny: boolean } {
  const candidateHostname = new URL(candidateOrigin).hostname;
  const onSite = locs.filter((u) => {
    try {
      return isSameSite(new URL(u).hostname, candidateHostname);
    } catch {
      return false;
    }
  });
  const kept = onSite.slice(0, GATE_CONFIG.maxUrlsPerSitemap);
  return { kept, droppedAny: kept.length < locs.length };
}

/**
 * Walk a sitemap or sitemap-index starting at `rootUrls`, returning the
 * union of page URLs found on the candidate's own site. Per §5.2:
 * sitemap-index children are followed ONE LEVEL ONLY, capped at
 * maxSitemapIndexChildren; each leaf sitemap is capped at maxUrlsPerSitemap
 * <loc> entries and maxBytesPerSitemapFile bytes; any <loc> off the
 * candidate's eTLD+1 is dropped (it gets its own robots.txt verdict before
 * anything of it is fetched -- checkPage/checkSite in gate.ts do that
 * per-URL regardless, this is just scope hygiene at enumeration time).
 */
export async function enumerateSitemaps(rootUrls: string[], candidateOrigin: string): Promise<SitemapEnumeration> {
  const pageUrls: string[] = [];
  const sitemapsFetched: string[] = [];
  let truncated = false;

  const roots = [...new Set(rootUrls)];
  const childCandidates: string[] = [];

  for (const url of roots) {
    const result = await fetchOneSitemap(url);
    if (!result.fetched) continue;
    sitemapsFetched.push(url);
    truncated = truncated || result.truncated;

    if (result.isIndex) {
      const children = result.locs.slice(0, GATE_CONFIG.maxSitemapIndexChildren);
      if (children.length < result.locs.length) truncated = true;
      childCandidates.push(...children);
    } else {
      const { kept, droppedAny } = filterAndCap(result.locs, candidateOrigin);
      truncated = truncated || droppedAny;
      pageUrls.push(...kept);
    }
  }

  // One level only: fetch each index child, but never treat ITS contents as
  // another index to recurse into, even if it claims to be one.
  for (const url of new Set(childCandidates)) {
    if (sitemapsFetched.includes(url)) continue;
    const result = await fetchOneSitemap(url);
    if (!result.fetched) continue;
    sitemapsFetched.push(url);
    truncated = truncated || result.truncated;
    const { kept, droppedAny } = filterAndCap(result.locs, candidateOrigin);
    truncated = truncated || droppedAny;
    pageUrls.push(...kept);
  }

  return { pageUrls, sitemapsFetched, truncated };
}
