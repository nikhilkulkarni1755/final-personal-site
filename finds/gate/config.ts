// Policy configuration for the permission gate.
//
// This module is the ONLY place policy values live. Every threshold, ordering
// rule and UA string the gate applies is read from here, never hardcoded in
// the parser/verdict logic. When R2's rubric
// (finds-coord/research/R2-permission-rubric.md) lands, update the values
// below -- do not change logic in robots.ts / verdict.ts / gate.ts to match.
//
// Every value marked "PENDING R2" is a placeholder chosen defensively (i.e.
// more conservative than we'd guess the real rubric wants) so the gate fails
// closed rather than open while it is unwired.

export const GATE_CONFIG = {
  // Product token we identify as, and the full UA string we send. Never
  // spoof a browser UA to get past a block (HARD RULE). PENDING R2: exact
  // token + contact URL.
  userAgent: 'FindsBot/0.1 (+https://nikhilkulkarni1755.com/finds-bot)',
  userAgentProductToken: 'FindsBot',

  // How long a fetched robots.txt is trusted before we re-fetch it.
  // RFC 9309 suggests caching for a reasonable time and falling back to the
  // last-known-good copy on fetch failure, capped at 24h. PENDING R2.
  robotsTxtCacheTtlMs: 24 * 60 * 60 * 1000,

  // Hard ceilings on how much of a site we will ever enumerate/crawl,
  // independent of what robots.txt allows. PENDING R2.
  maxPagesPerSite: 50,
  maxCrawlDepth: 3,
  maxSitemapsPerSite: 10,
  maxUrlsPerSitemap: 500,

  // Minimum spacing between requests to the same origin when robots.txt
  // specifies no Crawl-delay. If Crawl-delay IS specified we use the larger
  // of the two. PENDING R2.
  defaultCrawlDelayMs: 1000,
  minCrawlDelayMs: 500,

  // Network behavior for fetching robots.txt / sitemaps / pages.
  requestTimeoutMs: 10_000,
  maxRedirects: 5,

  // Precedence order applied when signals disagree (most authoritative
  // first). PENDING R2 -- this ordering follows the IETF aipref / RFC 9309
  // convention (page-level signals override site-level ones) as a
  // conservative default, not a confirmed policy.
  signalPrecedence: ['x-robots-tag', 'meta-robots', 'robots-txt'] as const,

  // If we cannot determine permission for any reason (fetch error other
  // than a clean 4xx, malformed directive we can't safely interpret,
  // conflicting signals with no precedence rule that resolves them), the
  // verdict MUST be "not allowed". This is a hard rule (see lane brief),
  // not tunable by R2 downward -- R2 may only make the *conditions* under
  // which we fail closed more precise.
  failClosed: true,
} as const;

export type SignalSource = (typeof GATE_CONFIG.signalPrecedence)[number] | 'default';
