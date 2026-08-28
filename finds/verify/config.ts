/**
 * The numbers and strings R2's rubric hardcodes for anyone that touches a
 * third party's server. Copied here verbatim from
 * finds-coord/research/R2-permission-rubric.md so that W4's caps do not depend
 * on a gate being wired in correctly -- if the gate hands over a looser budget,
 * W4 still refuses to exceed these.
 *
 * These are ceilings, never targets. Nothing in this lane may raise one.
 */

/**
 * R2 §2.2 as amended by DECISIONS D11, byte for byte, and byte-identical to the
 * string published at https://nikhilkulkarni1755.com/bot.txt. D11 moved the URL
 * from /bot to /bot.txt because the SPA catch-all serves /bot as an empty React
 * shell, and a site owner reading their access log reaches for curl.
 *
 * Never a browser UA. Never a second UA after a block.
 */
export const USER_AGENT = 'InterestingFindsBot/1.0 (+https://nikhilkulkarni1755.com/bot.txt)';

/** R2 §2.3. No Cookie, no Authorization, ever -- asserted in gate.ts. */
export const REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'User-Agent': USER_AGENT,
  Accept:
    'text/html, application/xhtml+xml, text/markdown;q=0.9, text/plain;q=0.9, application/json;q=0.5, */*;q=0.1',
  'Accept-Language': 'en',
});

/**
 * R2 §5.3 -- and these exact numbers are now a public promise. bot.txt says
 * "at most 25 pages per site, at least 2 seconds apart" under Nikhil's name and
 * his email address. Raising one would make him a liar to the people whose
 * sites we read, so they are ceilings and never targets.
 */
export const R2_CAPS = {
  minDelayMs: 2000,
  maxPages: 25,
  maxDepth: 2,
  wallClockMs: 300_000,
  /** Per response, then the stream is aborted. */
  maxResponseBytes: 2 * 1024 * 1024,
  /** Across the whole candidate. */
  maxCandidateBytes: 20 * 1024 * 1024,
  connectTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
  maxRedirects: 5,
} as const;

/** R2 §5.3. Anything else -- images, PDF, video, archives -- is never fetched. */
export const ACCEPTED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/json',
] as const;

/**
 * R2 §5.4. Not fetched, whatever robots.txt says, because none of it is
 * evidence about a product and fetching it is pure downside.
 */
export const NEVER_TOUCH_PATTERNS: readonly RegExp[] = [
  /^\/wp-admin/i,
  /^\/admin/i,
  /^\/(log|sign)[-_]?(in|out|up)/i,
  // Not in R2 §5.4's literal list, which names /login, /signin, /signup and
  // /logout. A registration form is the same thing under a different word and
  // the first field run walked into one. Being stricter than the rubric is
  // always allowed; flagged to R2 as a proposed addition to §5.4.
  /^\/register\b/i,
  /^\/cart/i,
  /^\/checkout/i,
  /^\/account/i,
  /^\/settings/i,
  /\/unsubscribe/i,
];
