// Orchestrator: the one entrypoint lane W4 (or anything else) is allowed to
// fetch a page through. It ties the mechanism pieces together but invents
// no policy itself -- everything it decides traces back to config.ts or to
// a signal one of the reader modules actually observed.

import { GATE_CONFIG } from './config.ts';
import { TtlCache } from './cache.ts';
import { fetchRobotsTxt } from './robots.ts';
import { extractApplicableDirectives } from './headers.ts';
import { extractMetaRobotsDirectives } from './metaRobots.ts';
import { enumerateSitemaps } from './sitemap.ts';
import { buildVerdict } from './verdict.ts';
import type { AuditRecord, ParsedRobots, PathVerdict, SiteVerdict } from './types.ts';

const robotsCache = new TtlCache<ParsedRobots>(GATE_CONFIG.robotsTxtCacheTtlMs);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRobots(origin: string): Promise<ParsedRobots> {
  return robotsCache.getOrCompute(origin, () => fetchRobotsTxt(origin));
}

function crawlDelayMs(parsed: ParsedRobots): number {
  const group = parsed.groups.find((g) =>
    g.userAgents.includes(GATE_CONFIG.userAgentProductToken.toLowerCase()) || g.userAgents.includes('*'),
  );
  if (group?.crawlDelaySeconds !== undefined) {
    return Math.max(group.crawlDelaySeconds * 1000, GATE_CONFIG.minCrawlDelayMs);
  }
  return GATE_CONFIG.defaultCrawlDelayMs;
}

function buildSiteVerdict(origin: string, parsed: ParsedRobots): SiteVerdict {
  return {
    origin,
    robotsTxtUrl: new URL('/robots.txt', origin).toString(),
    robotsTxtStatus: parsed.fetched ? (parsed.status ?? 'unreachable') : 'unreachable',
    crawlDelayMs: crawlDelayMs(parsed),
    sitemaps: parsed.sitemaps,
    checkedAt: new Date().toISOString(),
    userAgent: GATE_CONFIG.userAgent,
  };
}

/** Fetch one page's own headers/body to read its X-Robots-Tag + meta robots. */
async function fetchPageOwnSignals(url: string): Promise<{ headerDirectives: string[]; metaDirectives: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATE_CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': GATE_CONFIG.userAgent },
    });
    const raw = res.headers.get('x-robots-tag');
    const headerDirectives = raw ? extractApplicableDirectives(raw, GATE_CONFIG.userAgentProductToken) : [];
    const contentType = res.headers.get('content-type') ?? '';
    let metaDirectives: string[] = [];
    if (contentType.includes('html')) {
      const body = await res.text();
      metaDirectives = extractMetaRobotsDirectives(body, GATE_CONFIG.userAgentProductToken);
    }
    return { headerDirectives, metaDirectives };
  } catch {
    // A page we can't fetch at all yields no additional disallow signal
    // here -- robots.txt reachability is checked separately and already
    // fails closed on its own. An unreachable individual page is just a
    // page we won't be able to use; that's reported by the caller, not
    // manufactured as a policy verdict.
    return { headerDirectives: [], metaDirectives: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Full permission check for one URL: fetch its robots.txt + own signals, build the verdict. */
export async function checkPage(url: string): Promise<AuditRecord> {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const robots = await getRobots(origin);
  const site = buildSiteVerdict(origin, robots);

  if (!robots.fetched) {
    const verdict: PathVerdict = {
      path: parsed.pathname + parsed.search,
      allowed: false,
      reason: 'robots.txt was unreachable (server error or network failure); failing closed',
      source: 'default',
    };
    return { url, verdict, site };
  }

  const ownSignals = await fetchPageOwnSignals(url);
  const verdict = buildVerdict(parsed.pathname + parsed.search, robots, {
    ...ownSignals,
    robotsReachable: true,
  });
  return { url, verdict, site };
}

export interface SiteCheckResult {
  site: SiteVerdict;
  allowed: AuditRecord[];
  disallowed: AuditRecord[];
  truncated: boolean;
}

/**
 * Enumerate a site's pages (from robots.txt Sitemap: directives, falling
 * back to the conventional /sitemap.xml) and check each against the gate,
 * up to config.maxPagesPerSite, respecting the site's crawl-delay.
 */
export async function checkSite(originUrl: string): Promise<SiteCheckResult> {
  const origin = new URL(originUrl).origin;
  const robots = await getRobots(origin);
  const site = buildSiteVerdict(origin, robots);

  if (!robots.fetched) {
    return { site, allowed: [], disallowed: [], truncated: false };
  }

  const sitemapRoots = robots.sitemaps.length > 0 ? robots.sitemaps : [new URL('/sitemap.xml', origin).toString()];
  const enumeration = await enumerateSitemaps(sitemapRoots);

  const candidates = enumeration.pageUrls.slice(0, GATE_CONFIG.maxPagesPerSite);
  const truncated = enumeration.truncated || candidates.length < enumeration.pageUrls.length;

  const allowed: AuditRecord[] = [];
  const disallowed: AuditRecord[] = [];
  const delay = crawlDelayMs(robots);

  for (let i = 0; i < candidates.length; i++) {
    const record = await checkPage(candidates[i]);
    (record.verdict.allowed ? allowed : disallowed).push(record);
    if (i < candidates.length - 1) await sleep(delay);
  }

  return { site, allowed, disallowed, truncated };
}
