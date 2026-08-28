// RFC 9309 robots.txt fetcher + parser.
//
// Fetching semantics (RFC 9309 §2.3.1):
//   - 2xx ("available")   -> parse and follow the rules found.
//   - 4xx ("unavailable") -> no robots.txt exists; full access is permitted.
//     This is NOT the same as "ambiguous" -- the absence of a robots.txt is
//     a well-defined case under the spec, so it is not subject to our
//     fail-closed hard rule.
//   - 5xx / network error / redirect loop ("unreachable") -> the server is
//     there but we could not retrieve its policy. RFC 9309 requires treating
//     this as complete disallow, which also matches our own fail-closed rule.
//
// Redirects are followed manually (capped at config.maxRedirects) so we can
// tell "too many redirects" apart from a real fetch failure.

import { GATE_CONFIG } from './config.ts';
import type { ParsedRobots, RobotsGroup, RobotsRule } from './types.ts';

async function fetchWithRedirects(
  url: string,
  maxRedirects: number,
  timeoutMs: number,
  userAgent: string,
): Promise<Response> {
  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': userAgent },
      });
    } finally {
      clearTimeout(timer);
    }
    const isRedirect = res.status >= 300 && res.status < 400;
    if (!isRedirect) return res;
    const location = res.headers.get('location');
    if (!location) return res; // redirect status with no Location: treat as-is
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error(`exceeded ${maxRedirects} redirects fetching ${url}`);
}

/** Strip a "# comment" tail and surrounding whitespace from one line. */
function stripComment(line: string): string {
  const hashIdx = line.indexOf('#');
  return (hashIdx >= 0 ? line.slice(0, hashIdx) : line).trim();
}

export function parseRobotsTxt(text: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let currentUserAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let currentCrawlDelay: number | undefined;
  let ruleSeenForCurrentBlock = false;

  const flush = () => {
    if (currentUserAgents.length > 0) {
      groups.push({
        userAgents: currentUserAgents,
        rules: currentRules,
        crawlDelaySeconds: currentCrawlDelay,
      });
    }
    currentUserAgents = [];
    currentRules = [];
    currentCrawlDelay = undefined;
    ruleSeenForCurrentBlock = false;
  };

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = stripComment(raw);
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue; // malformed directive line; ignore per spec

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (!value) break;
        if (ruleSeenForCurrentBlock) flush(); // a new UA line after rules starts a new group
        currentUserAgents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (currentUserAgents.length === 0) break; // rule with no preceding UA line; ignore
        ruleSeenForCurrentBlock = true;
        if (field === 'disallow' && value === '') break; // "Disallow:" empty = allow all
        currentRules.push({ directive: field, pattern: value });
        break;
      }
      case 'crawl-delay': {
        if (currentUserAgents.length === 0) break;
        ruleSeenForCurrentBlock = true;
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) currentCrawlDelay = seconds;
        break;
      }
      case 'sitemap': {
        if (value) sitemaps.push(value);
        break;
      }
      default:
        break; // unknown field; ignore per spec
    }
  }
  flush();

  return { groups, sitemaps };
}

export async function fetchRobotsTxt(origin: string): Promise<ParsedRobots> {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  let res: Response;
  try {
    res = await fetchWithRedirects(
      robotsUrl,
      GATE_CONFIG.maxRedirects,
      GATE_CONFIG.requestTimeoutMs,
      GATE_CONFIG.userAgent,
    );
  } catch {
    // Network error, timeout, or redirect loop -> "unreachable" per RFC 9309.
    return { groups: [], sitemaps: [], fetched: false, status: null };
  }

  if (res.status >= 200 && res.status < 300) {
    const text = await res.text();
    const { groups, sitemaps } = parseRobotsTxt(text);
    return { groups, sitemaps, fetched: true, status: res.status };
  }

  if (res.status >= 400 && res.status < 500) {
    // "Unavailable": no robots.txt exists. Full access is permitted -- this
    // is a defined outcome, not an ambiguity, so we do not fail closed here.
    return { groups: [], sitemaps: [], fetched: true, status: res.status };
  }

  // 5xx or other unexpected status: "unreachable" -> fail closed.
  return { groups: [], sitemaps: [], fetched: false, status: res.status };
}

/** Convert one robots.txt path pattern into a matcher, per RFC 9309 §2.2.3. */
function compilePattern(pattern: string): RegExp {
  const endAnchored = pattern.endsWith('$');
  const body = endAnchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${endAnchored ? '$' : ''}`);
}

/** Select the most specific group for our user-agent token, per §2.2.1. */
export function selectGroup(groups: RobotsGroup[], productToken: string): RobotsGroup | null {
  const token = productToken.toLowerCase();
  const exact = groups.filter((g) => g.userAgents.includes(token));
  if (exact.length > 0) {
    return {
      userAgents: [token],
      rules: exact.flatMap((g) => g.rules),
      crawlDelaySeconds: exact.map((g) => g.crawlDelaySeconds).find((d) => d !== undefined),
    };
  }
  const wildcard = groups.filter((g) => g.userAgents.includes('*'));
  if (wildcard.length > 0) {
    return {
      userAgents: ['*'],
      rules: wildcard.flatMap((g) => g.rules),
      crawlDelaySeconds: wildcard.map((g) => g.crawlDelaySeconds).find((d) => d !== undefined),
    };
  }
  return null; // no applicable group -> no restrictions
}

export interface RobotsMatch {
  allowed: boolean;
  matchedRule?: string;
}

/**
 * Decide allow/disallow for one path against a group's rules using
 * longest-match precedence, ties broken in favor of Allow (§2.2.2).
 */
export function matchPath(group: RobotsGroup | null, path: string): RobotsMatch {
  if (!group || group.rules.length === 0) return { allowed: true };

  let best: { rule: RobotsRule; length: number } | null = null;
  for (const rule of group.rules) {
    if (!compilePattern(rule.pattern).test(path)) continue;
    const length = rule.pattern.length;
    if (
      best === null ||
      length > best.length ||
      (length === best.length && rule.directive === 'allow' && best.rule.directive === 'disallow')
    ) {
      best = { rule, length };
    }
  }

  if (!best) return { allowed: true };
  return {
    allowed: best.rule.directive === 'allow',
    matchedRule: `${best.rule.directive}: ${best.rule.pattern}`,
  };
}
