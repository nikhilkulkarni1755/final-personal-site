// Policy configuration for the permission gate.
//
// Every threshold, UA string, and precedence value here is sourced from
// finds-coord/research/R2-permission-rubric.md v1.0 (R2 is the policy
// author; W1 -- this code -- is the implementer). Where a comment cites a
// section number ("§x.y"), that is this file's only justification for the
// value; do not tune it locally. If R2 ships a v1.1, update values here and
// change no logic elsewhere in finds/gate/**.

export const GATE_CONFIG = {
  // §2.1 / §2.2 -- identity. Sent byte-for-byte on every request, robots.txt
  // included. Never a browser UA (§2.2, §2.3): a block is an answer.
  userAgentProductToken: 'InterestingFindsBot',
  // D11 (coordinator override of R2 §2.2): points at /bot.txt, not /bot.
  // The site's SPA catch-all (_redirects: /* /index.html 200) means /bot
  // serves an empty shell to curl; /bot.txt is a static file and serves
  // real bytes today. Revisit if R2/W7 ship a real /bot route and object.
  userAgent: 'InterestingFindsBot/1.0 (+https://nikhilkulkarni1755.com/bot.txt)',
  rubricVersion: 'R2-permission-rubric/1.1',
  gateVersion: '1.0.0',

  // §2.3 -- headers always sent alongside User-Agent.
  requestHeaders: {
    Accept: 'text/html, application/xhtml+xml, text/markdown;q=0.9, text/plain;q=0.9, application/json;q=0.5, */*;q=0.1',
    'Accept-Encoding': 'gzip, br',
    'Accept-Language': 'en',
  },

  // §5.3 -- the hard numbers.
  requestMethods: ['GET', 'HEAD'] as const,
  concurrencyPerAuthority: 1,
  concurrencyAcrossAuthorities: 4,
  baseDelayMs: 2000,
  minCrawlDelaySeconds: 2, // delay = max(robots Crawl-delay, this) when a Crawl-delay is present
  maxCrawlDepth: 2, // homepage = 0
  wallClockMsPerCandidate: 300_000,
  maxResponseBytes: 2 * 1024 * 1024, // abort the stream past this
  maxBytesPerCandidate: 20 * 1024 * 1024,
  connectTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
  maxRedirects: 5, // §2.3.1.2 / §5.3, robots.txt and pages alike
  acceptedContentTypes: ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'application/json'],
  retryCount: 1, // only on 5xx / timeout
  retryDelayMs: 5000,
  frequency: 'once per day per candidate',

  // §5.3 page-cap formula: min(25, max(3, floor(300 / delay_seconds))).
  maxPagesAbsoluteCap: 25,
  maxPagesFloor: 3,
  pageCapDelayBudgetSeconds: 300,

  // §5.2 sitemap handling.
  maxSitemapIndexChildren: 5, // one level only
  maxUrlsPerSitemap: 500,
  maxBytesPerSitemapFile: 2 * 1024 * 1024,

  // §1.2 / §2.5 robots.txt parse contract.
  robotsTxtMaxBytes: 512_000, // "at least 500 KiB" (§2.5); we parse exactly this much

  // §3.3 / §3.4 -- the AI-crawler-block inference (rule P5).
  // Matched case-insensitively against robots.txt product tokens. Verified
  // (✓ in the rubric) tokens and widely-published third-party entries are
  // both included as inference inputs only -- never assumed as identities.
  aiCrawlerTokens: [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'OAI-AdsBot',
    'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'Claude-Web', 'anthropic-ai',
    'Google-Extended', 'Applebot-Extended', 'CCBot', 'PerplexityBot',
    'Perplexity-User', 'meta-externalagent', 'meta-externalfetcher',
    'Amazonbot', 'Bytespider', 'cohere-ai', 'cohere-training-data-crawler',
    'Diffbot', 'FacebookBot', 'ImagesiftBot', 'omgili', 'Omgilibot', 'YouBot',
    'AI2Bot', 'Timpibot', 'DuckAssistBot', 'PanguBot', 'Webzio-Extended',
    'Kangaroo Bot', 'FriendlyCrawler', 'img2dataset', 'Applebot', 'Meta-ExternalAgent',
  ],
  // §3.3 -- 2 or more distinct blocked AI tokens is a pattern; 1 is noise.
  aiBlockInferenceThreshold: 2,

  // §6 evidence: response headers are recorded as an ALLOWLISTED subset,
  // never the whole bag -- and never Cookie/Set-Cookie/Authorization, which
  // safeFetch.ts additionally refuses to let us send in the first place.
  evidenceResponseHeaderAllowlist: [
    'content-type', 'server', 'cf-mitigated', 'retry-after', 'x-robots-tag',
    'tdm-reservation', 'tdm-policy', 'content-usage', 'content-signal',
    'cache-control', 'etag', 'last-modified', 'x-amzn-waf-action',
  ],

  // Path to the manual denylist (P0). One eTLD+1 per line, `#` comments.
  // Read fresh on every call -- no caching, no restart required (§8.11).
  denylistPath: new URL('./denylist.txt', import.meta.url).pathname,

  // §5.4 -- never fetched regardless of what robots.txt says, because none
  // of it is evidence about a product.
  neverTouchPathPatterns: [
    /^\/wp-admin/i, /^\/admin/i, /^\/login/i, /^\/signin/i, /^\/signup/i,
    /^\/logout/i, /^\/cart/i, /^\/checkout/i, /^\/account/i, /^\/settings/i,
    /unsubscribe/i,
  ],

  // §5.1 -- ranking heuristic ONLY, never a permission signal.
  highSignalPaths: ['/', '/pricing', '/docs', '/about', '/features', '/how-it-works', '/api', '/changelog', '/faq', '/blog'],

  // §7 -- cache TTLs, keyed by verdict class. Cache key is the authority
  // (scheme://host[:port], §2.3/§2.4), never the registrable domain.
  ttl: {
    allowMs: 6 * 60 * 60 * 1000, // 6h; well inside RFC 9309's 24h ceiling
    allowMaxMs: 6 * 60 * 60 * 1000, // never honour an operator's max-age beyond this
    denyRobotsMs: 24 * 60 * 60 * 1000, // robots_disallow / robots_wildcard_disallow / ai_block_inferred
    denyUnreachableMs: 60 * 60 * 1000, // 5xx / network error -- transient
    denyBlockedMs: 7 * 24 * 60 * 60 * 1000, // 401/403/429/451/bot_challenge -- a config, not a blip
    denylistMs: Infinity, // manual_denylist -- never expires
    unhandledMs: 60 * 60 * 1000, // unhandled_case -- short, R2 may ship a rule
  },
} as const;

export type ReasonCode =
  // ALLOW
  | 'robots_exact_group'
  | 'robots_allow'
  | 'robots_wildcard_allow'
  | 'robots_no_rules'
  | 'robots_absent'
  | 'robots_soft_404'
  | 'robots_redirect_loop'
  // DENY
  | 'manual_denylist'
  | 'url_out_of_scope'
  | 'robots_disallow'
  | 'robots_wildcard_disallow'
  | 'ai_block_inferred'
  | 'robots_forbidden'
  | 'robots_rate_limited'
  | 'robots_server_error'
  | 'robots_unreachable'
  | 'robots_bad_success'
  | 'origin_blocked_us'
  | 'origin_rate_limited'
  | 'bot_challenge'
  | 'unhandled_case';

export type DecidingSignal =
  | 'MANUAL_DENYLIST'
  | 'URL_POLICY'
  | 'ROBOTS_TXT'
  | 'AI_BLOCK_INFERENCE'
  | 'HTTP_STATUS'
  | 'BOT_CHALLENGE'
  | 'RATE_LIMIT'
  | 'CACHED_VERDICT'
  | 'UNHANDLED';

export type UseSignal =
  | 'X_ROBOTS_TAG'
  | 'ROBOTS_META'
  | 'CONTENT_SIGNAL'
  | 'CONTENT_USAGE'
  | 'TDM_RESERVATION'
  | 'NOAI_META';

export type GroupSelectionBasis = 'EXACT' | 'WILDCARD' | 'AI_BLOCK_INFERENCE' | 'NO_GROUP' | 'NO_FILE';
