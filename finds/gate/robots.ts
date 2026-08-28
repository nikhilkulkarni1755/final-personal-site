// RFC 9309 robots.txt fetcher + parser, per
// finds-coord/research/R2-permission-rubric.md §1.2/§1.3.
//
// Fetch semantics (§1.3, table) -- deliberately NOT the naive RFC 9309
// reading in three places, each justified there:
//   - only a clean 200 counts as "available"; any other 2xx (a 202 WAF
//     challenge with an empty body is the observed case) is a DENY.
//   - 401/403 on robots.txt is a DENY, not "no restrictions" -- a server
//     refusing to hand us its own policy file is refusing us.
//   - 429 is a DENY, matching Google's own carve-out from the 4xx bucket.
// A 200 whose body is HTML (an SPA catch-all) is treated as "absent", same
// as a 404. 5xx / network error / >5 redirect hops each map per the table.

import { createHash } from 'node:crypto';
import { GATE_CONFIG } from './config.ts';
import { safeFetch } from './safeFetch.ts';
import type { ContentSignal, ContentUsage, RobotsGroup, RobotsOutcome, RobotsRule } from './types.ts';

async function fetchWithRedirects(
  url: string,
  maxRedirects: number,
  timeoutMs: number,
): Promise<{ res: Response; finalUrl: string; redirectHops: number }> {
  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await safeFetch(currentUrl, { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const isRedirect = res.status >= 300 && res.status < 400;
    if (!isRedirect) return { res, finalUrl: currentUrl, redirectHops: hop };
    const location = res.headers.get('location');
    if (!location) return { res, finalUrl: currentUrl, redirectHops: hop };
    if (hop === maxRedirects) throw new RedirectLoopError();
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new RedirectLoopError();
}

class RedirectLoopError extends Error {
  constructor() {
    super('exceeded max redirects');
  }
}

function stripComment(line: string): string {
  const hashIdx = line.indexOf('#');
  return (hashIdx >= 0 ? line.slice(0, hashIdx) : line).trim();
}

/** §1.5 S8: "Content-Signal: search=yes, ai-input=yes, ai-train=no". */
function parseContentSignal(value: string): ContentSignal {
  const out: ContentSignal = {};
  for (const pair of value.split(',')) {
    const [rawKey, rawVal] = pair.split('=').map((s) => s.trim().toLowerCase());
    if (!rawKey || (rawVal !== 'yes' && rawVal !== 'no')) continue;
    if (rawKey === 'search') out.search = rawVal;
    else if (rawKey === 'ai-input') out.ai_input = rawVal;
    else if (rawKey === 'ai-train') out.ai_train = rawVal;
    else if (rawKey === 'use') out.use = rawVal;
  }
  return out;
}

/** §1.5 S9 (aipref): "Content-Usage: train-ai=n" or "Content-Usage: search=y".
 * Path-scoped forms ("Content-Usage: /ai-ok/ train-ai=y") are not parsed by
 * this v1 -- flagged as a known gap; we only read the origin-wide form. */
function parseContentUsage(value: string): ContentUsage | null {
  const trimmed = value.trim();
  if (/^\//.test(trimmed)) return null; // path-scoped form; not handled, see above
  const out: ContentUsage = {};
  for (const pair of trimmed.split(/\s+/)) {
    const [rawKey, rawVal] = pair.split('=').map((s) => s.trim().toLowerCase());
    if (!rawKey || (rawVal !== 'y' && rawVal !== 'n')) continue;
    if (rawKey === 'train-ai') out.train_ai = rawVal;
    else if (rawKey === 'search') out.search = rawVal;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** RFC 9309 §2.2.2: normalise percent-encoding on both sides before comparing. */
function normalizePercentEncoding(s: string): string {
  try {
    // Re-encode then decode unreserved characters consistently; a failing
    // decode (malformed %-sequence) is left as-is rather than thrown.
    return s.replace(/%[0-9a-fA-F]{2}/g, (seq) => {
      const decoded = decodeURIComponent(seq);
      // Keep reserved/unsafe characters percent-encoded (uppercase), decode
      // the rest, matching how conformant robots.txt parsers normalise.
      return /^[A-Za-z0-9\-._~]$/.test(decoded) ? decoded : seq.toUpperCase();
    });
  } catch {
    return s;
  }
}

export function parseRobotsTxt(text: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let currentUserAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let currentCrawlDelay: number | undefined;
  let currentContentSignal: ContentSignal | undefined;
  let currentContentUsage: ContentUsage | undefined;
  let ruleSeenForCurrentBlock = false;

  const flush = () => {
    if (currentUserAgents.length > 0) {
      groups.push({
        userAgents: currentUserAgents,
        rules: currentRules,
        crawlDelaySeconds: currentCrawlDelay,
        contentSignal: currentContentSignal,
        contentUsage: currentContentUsage,
      });
    }
    currentUserAgents = [];
    currentRules = [];
    currentCrawlDelay = undefined;
    currentContentSignal = undefined;
    currentContentUsage = undefined;
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
        // §1.2 rule 7 (implicitly): only lines after a UA line count as its
        // rules. A NEW ua line after rules were already collected starts a
        // fresh group; consecutive UA lines with no rules between them
        // belong to the same group (RFC 9309 §2.2.1: "multiple groups with
        // the same token merge into one").
        if (ruleSeenForCurrentBlock) flush();
        currentUserAgents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (currentUserAgents.length === 0) break; // rule before any UA line; ignore
        ruleSeenForCurrentBlock = true;
        if (field === 'disallow' && value === '') break; // §1.2 rule 6: empty pattern = no-op
        currentRules.push({ directive: field, pattern: normalizePercentEncoding(value) });
        break;
      }
      case 'crawl-delay': {
        if (currentUserAgents.length === 0) break;
        ruleSeenForCurrentBlock = true;
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) currentCrawlDelay = seconds;
        break;
      }
      case 'content-signal': {
        if (currentUserAgents.length === 0) break;
        ruleSeenForCurrentBlock = true;
        currentContentSignal = parseContentSignal(value);
        break;
      }
      case 'content-usage': {
        if (currentUserAgents.length === 0) break;
        ruleSeenForCurrentBlock = true;
        const parsed = parseContentUsage(value);
        if (parsed) currentContentUsage = parsed;
        break;
      }
      case 'sitemap': {
        if (value) sitemaps.push(value); // §1.2: not gated on a preceding UA line
        break;
      }
      default:
        break; // unknown field; ignore per spec
    }
  }
  flush();

  return { groups, sitemaps };
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html)/i.test(text);
}

/** §1.3 table: a response carrying either header is a challenge interstitial,
 * not a real answer, regardless of status code. Exported for reuse on
 * page-level fetches (gate.ts), where the same rule applies (§3.1 P3). */
export function isBotChallenge(res: Response): boolean {
  return res.headers.get('cf-mitigated') === 'challenge' || res.headers.has('x-amzn-waf-action');
}

/** Fetch and classify robots.txt per the three-way outcome of §1.3. */
export async function fetchRobotsTxt(origin: string): Promise<RobotsOutcome> {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  const startedAt = Date.now();
  let fetched: { res: Response; finalUrl: string; redirectHops: number };
  try {
    fetched = await fetchWithRedirects(robotsUrl, GATE_CONFIG.maxRedirects, GATE_CONFIG.connectTimeoutMs);
  } catch (err) {
    if (err instanceof RedirectLoopError) {
      // >5 hops -> §2.3.1.2 "MAY assume unavailable" -> §1.3: treat as absent.
      return { kind: 'absent', reasonCode: 'robots_redirect_loop', status: null };
    }
    return { kind: 'denied', reasonCode: 'robots_unreachable', status: null };
  }

  const { res, redirectHops } = fetched;

  // >5 hops surfaces as an exception above (redirect-loop); redirect landing
  // on a non-redirect response within budget falls through to normal status
  // handling below, exactly as the table prescribes.

  if (isBotChallenge(res)) {
    return { kind: 'denied', reasonCode: 'bot_challenge', status: res.status };
  }

  if (res.status === 200) {
    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.byteLength > GATE_CONFIG.robotsTxtMaxBytes;
    const capped = truncated ? buf.subarray(0, GATE_CONFIG.robotsTxtMaxBytes) : buf;
    const text = capped.toString('utf-8');

    if (looksLikeHtml(text)) {
      return { kind: 'absent', reasonCode: 'robots_soft_404', status: 200 };
    }

    const { groups, sitemaps } = parseRobotsTxt(text);
    return {
      kind: 'parsed',
      groups,
      sitemaps,
      truncated,
      byteLength: buf.byteLength,
      finalUrl: fetched.finalUrl,
      redirectHops,
      status: 200,
      contentType: res.headers.get('content-type'),
      sha256: createHash('sha256').update(capped).digest('hex'),
      elapsedMs: Date.now() - startedAt,
      bodyText: text,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: 'denied', reasonCode: 'robots_forbidden', status: res.status };
  }
  if (res.status === 429) {
    return { kind: 'denied', reasonCode: 'robots_rate_limited', status: res.status };
  }
  if (res.status >= 400 && res.status < 500) {
    return { kind: 'absent', reasonCode: 'robots_absent', status: res.status };
  }
  if (res.status >= 500) {
    return { kind: 'denied', reasonCode: 'robots_server_error', status: res.status };
  }
  // Any other non-200 2xx (201/202/204/...): a WAF challenge with an empty
  // body is the documented case (§1.3 box). Only 200 counts as "available".
  return { kind: 'denied', reasonCode: 'robots_bad_success', status: res.status };
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

export interface GroupSelection {
  group: RobotsGroup | null;
  basis: 'EXACT' | 'WILDCARD' | 'AI_BLOCK_INFERENCE' | 'NO_GROUP';
  matchedToken: string | null;
  aiTokensDisallowed: string[];
}

/**
 * Select the group whose rules govern us, implementing precedence rules
 * P4-P7 (§3.1): exact token match wins outright; failing that, the
 * AI-crawler-block inference (P5, §3.3) fires when >=2 known AI-crawler
 * tokens are each disallowed with a non-empty path; failing that, the `*`
 * group; failing that, no group applies (full access, P7).
 */
export function selectGroup(groups: RobotsGroup[], productToken: string): GroupSelection {
  const token = productToken.toLowerCase();

  const exact = groups.filter((g) => g.userAgents.includes(token));
  if (exact.length > 0) {
    return {
      group: mergeGroups(exact, [token]),
      basis: 'EXACT',
      matchedToken: productToken,
      aiTokensDisallowed: [],
    };
  }

  const aiTokensLower = new Set(GATE_CONFIG.aiCrawlerTokens.map((t) => t.toLowerCase()));
  const blockedAiGroups = groups.filter(
    (g) =>
      g.userAgents.some((ua) => aiTokensLower.has(ua)) &&
      g.rules.some((r) => r.directive === 'disallow' && r.pattern !== ''),
  );
  const blockedAiTokens = [...new Set(blockedAiGroups.flatMap((g) => g.userAgents.filter((ua) => aiTokensLower.has(ua))))];
  if (blockedAiTokens.length >= GATE_CONFIG.aiBlockInferenceThreshold) {
    return {
      group: mergeGroups(blockedAiGroups, blockedAiGroups.flatMap((g) => g.userAgents)),
      basis: 'AI_BLOCK_INFERENCE',
      matchedToken: null,
      aiTokensDisallowed: blockedAiTokens,
    };
  }

  const wildcard = groups.filter((g) => g.userAgents.includes('*'));
  if (wildcard.length > 0) {
    return {
      group: mergeGroups(wildcard, ['*']),
      basis: 'WILDCARD',
      matchedToken: '*',
      aiTokensDisallowed: [],
    };
  }

  return { group: null, basis: 'NO_GROUP', matchedToken: null, aiTokensDisallowed: [] };
}

function mergeGroups(groups: RobotsGroup[], userAgents: string[]): RobotsGroup {
  return {
    userAgents,
    rules: groups.flatMap((g) => g.rules),
    crawlDelaySeconds: groups.map((g) => g.crawlDelaySeconds).find((d) => d !== undefined),
    contentSignal: groups.map((g) => g.contentSignal).find((c) => c !== undefined),
    contentUsage: groups.map((g) => g.contentUsage).find((c) => c !== undefined),
  };
}

export interface RobotsMatch {
  allowed: boolean;
  matchedRule?: string;
}

/**
 * Decide allow/disallow for one path against a group's rules using
 * longest-match precedence, ties broken in favor of Allow (§1.2 rules 2-4).
 */
export function matchPath(group: RobotsGroup | null, path: string): RobotsMatch {
  if (!group || group.rules.length === 0) return { allowed: true };

  const normalizedPath = normalizePercentEncoding(path);
  let best: { rule: RobotsRule; length: number } | null = null;
  for (const rule of group.rules) {
    if (!compilePattern(rule.pattern).test(normalizedPath)) continue;
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
