// The ACCESS decision -- rubric §3.1: "may we fetch this URL?" Evaluated in
// exact P0-P8 order, short-circuiting on the first DENY. This module never
// looks at X-Robots-Tag, meta robots, Content-Signal, Content-Usage, or
// tdm-reservation -- those are USE-axis signals (see use.ts) and §0 is
// explicit that a USE signal cannot forbid a fetch: you have to fetch the
// page to read it.

import { GATE_CONFIG } from './config.ts';
import type { DecidingSignal, GroupSelectionBasis, ReasonCode } from './config.ts';
import { isDenylisted } from './denylist.ts';
import { matchPath, selectGroup } from './robots.ts';
import { checkUrlScope } from './scope.ts';
import type { RobotsOutcome } from './types.ts';

export interface AuthorityDenial {
  reasonCode: ReasonCode;
  decidingSignal: DecidingSignal;
  detail: string;
}

/** Tracks P2 (already-denied origins) and P3 (server refusal this run)
 * across every URL checked in one process run. Create one per crawl run
 * (gate.ts owns the instance); never persisted, never shared across runs --
 * that would need the TTL cache instead (§7 handles cross-run memory). */
export interface RunState {
  deniedAuthorities: Map<string, AuthorityDenial>;
}

export function createRunState(): RunState {
  return { deniedAuthorities: new Map() };
}

/** Called by gate.ts after any page-level fetch (not robots.txt, which
 * already produces its own deny) returns 401/403/429/451 or a bot
 * challenge. Protects every OTHER URL on the same authority for the rest of
 * this run (P3); the URL that triggered it gets its own direct verdict. */
export function recordAuthorityDenial(state: RunState, authority: string, denial: AuthorityDenial): void {
  if (!state.deniedAuthorities.has(authority)) state.deniedAuthorities.set(authority, denial);
}

export interface AccessDecision {
  allowed: boolean;
  reasonCode: ReasonCode;
  reasonDetail: string;
  decidingSignal: DecidingSignal;
  decidingRule: string | null;
  decidingGroup: string | null;
  precedenceRule: string;
  groupSelectionBasis: GroupSelectionBasis;
  matchedGroupToken: string | null;
  aiTokensDisallowed: string[];
  crawlDelaySeconds: number | null;
}

const ROBOTS_DENY_SIGNAL: Record<'robots_forbidden' | 'robots_rate_limited' | 'robots_server_error' | 'robots_unreachable' | 'robots_bad_success' | 'bot_challenge', DecidingSignal> = {
  robots_forbidden: 'HTTP_STATUS',
  robots_rate_limited: 'RATE_LIMIT',
  robots_server_error: 'HTTP_STATUS',
  robots_unreachable: 'HTTP_STATUS',
  robots_bad_success: 'BOT_CHALLENGE',
  bot_challenge: 'BOT_CHALLENGE',
};

const ROBOTS_DENY_DETAIL: Record<'robots_forbidden' | 'robots_rate_limited' | 'robots_server_error' | 'robots_unreachable' | 'robots_bad_success' | 'bot_challenge', string> = {
  robots_forbidden: 'robots.txt returned 401/403 -- a refusal to hand us its own policy file (§1.3 deviation)',
  robots_rate_limited: 'robots.txt returned 429',
  robots_server_error: 'robots.txt returned 5xx (RFC 9309 §2.3.1.4: assume complete disallow)',
  robots_unreachable: 'robots.txt was unreachable (DNS/TCP/TLS/timeout)',
  robots_bad_success: 'robots.txt returned a non-200 2xx -- not a successful download (§1.3)',
  bot_challenge: 'response carried a bot-challenge header (cf-mitigated / x-amzn-waf-action)',
};

/** Implements P0-P8 (§3.1). `robotsOutcome` must already be fetched for the
 * URL's own authority (gate.ts caches this per authority, per §7's TTL
 * table). `candidateOrigin` is the site under evaluation, used for the P1
 * scope check -- for a top-level checkPage(url) call it is url's own
 * origin; for checkSite's enumeration it is the site being crawled. */
export async function decideAccess(
  url: string,
  candidateOrigin: string,
  robotsOutcome: RobotsOutcome,
  runState: RunState,
): Promise<AccessDecision> {
  const parsed = new URL(url);
  const authority = parsed.origin;

  // P0 -- manual denylist. Outranks everything, including robots.txt saying yes.
  if (isDenylisted(parsed.hostname)) {
    return deny('manual_denylist', 'MANUAL_DENYLIST', 'domain is on finds/gate/denylist.txt', 'P0');
  }

  // P1 -- URL sanity: scheme, private/loopback/CGNAT resolution, own eTLD+1.
  const scope = await checkUrlScope(url, candidateOrigin);
  if (!scope.inScope) {
    return deny('url_out_of_scope', 'URL_POLICY', scope.reason ?? 'URL is out of scope', 'P1');
  }

  // P2 -- a live cached DENY verdict for this authority, from earlier in this run.
  const prior = runState.deniedAuthorities.get(authority);
  if (prior) {
    return deny(prior.reasonCode, 'CACHED_VERDICT', `propagated from an earlier request this run: ${prior.detail}`, 'P2');
  }

  // P3 (server refusal from a PAGE fetch, not robots.txt) is enforced via P2:
  // gate.ts calls recordAuthorityDenial() the moment a page fetch on this
  // authority returns 401/403/429/451/challenge, which P2 then picks up for
  // every subsequent URL. The triggering fetch's own verdict is built
  // directly by gate.ts, not here.

  // P4-P7 -- robots.txt, per §1.2/§1.3 and the parse contract.
  if (robotsOutcome.kind === 'denied') {
    return deny(robotsOutcome.reasonCode, ROBOTS_DENY_SIGNAL[robotsOutcome.reasonCode], ROBOTS_DENY_DETAIL[robotsOutcome.reasonCode], 'P4');
  }
  if (robotsOutcome.kind === 'absent') {
    return allow(robotsOutcome.reasonCode, 'ROBOTS_TXT', absentDetail(robotsOutcome.reasonCode), 'P4', 'NO_FILE', null, [], null, null);
  }

  const path = parsed.pathname + parsed.search;
  const selection = selectGroup(robotsOutcome.groups, GATE_CONFIG.userAgentProductToken);
  const crawlDelay = selection.group?.crawlDelaySeconds ?? null;

  if (selection.basis === 'NO_GROUP') {
    return allow('robots_no_rules', 'ROBOTS_TXT', 'robots.txt parsed but no group applies (RFC 9309 §2.2.1)', 'P7', 'NO_GROUP', null, [], crawlDelay, null);
  }

  const match = matchPath(selection.group, path);

  if (selection.basis === 'EXACT') {
    return match.allowed
      ? allow('robots_exact_group', 'ROBOTS_TXT', ruleDetail(match.matchedRule, true), 'P4', 'EXACT', selection.matchedToken, [], crawlDelay, match.matchedRule ?? null)
      : deny('robots_disallow', 'ROBOTS_TXT', ruleDetail(match.matchedRule, false), 'P4', 'EXACT', selection.matchedToken, match.matchedRule ?? null, crawlDelay, []);
  }

  if (selection.basis === 'AI_BLOCK_INFERENCE') {
    const tokenList = selection.aiTokensDisallowed.join(', ');
    return match.allowed
      ? allow('robots_allow', 'AI_BLOCK_INFERENCE', `No group for ${GATE_CONFIG.userAgentProductToken}; permitted under the inferred AI-block group (tokens: ${tokenList})`, 'P5', 'AI_BLOCK_INFERENCE', null, selection.aiTokensDisallowed, crawlDelay, match.matchedRule ?? null)
      : deny('ai_block_inferred', 'AI_BLOCK_INFERENCE', `No group for ${GATE_CONFIG.userAgentProductToken}. robots.txt disallows ${selection.aiTokensDisallowed.length} known AI crawler tokens (${tokenList}); rule P5 adopts the most restrictive`, 'P5', 'AI_BLOCK_INFERENCE', null, match.matchedRule ?? null, crawlDelay, selection.aiTokensDisallowed);
  }

  // WILDCARD (P6)
  return match.allowed
    ? allow('robots_wildcard_allow', 'ROBOTS_TXT', ruleDetail(match.matchedRule, true), 'P6', 'WILDCARD', '*', [], crawlDelay, match.matchedRule ?? null)
    : deny('robots_wildcard_disallow', 'ROBOTS_TXT', ruleDetail(match.matchedRule, false), 'P6', 'WILDCARD', '*', match.matchedRule ?? null, crawlDelay, []);
}

function absentDetail(code: 'robots_absent' | 'robots_soft_404' | 'robots_redirect_loop'): string {
  switch (code) {
    case 'robots_absent':
      return 'no robots.txt (4xx) -- RFC 9309 §2.3.1.3, full access permitted';
    case 'robots_soft_404':
      return 'robots.txt returned 200 but an HTML body (SPA catch-all) -- treated as absent';
    case 'robots_redirect_loop':
      return 'robots.txt exceeded the redirect limit -- treated as absent (§2.3.1.2)';
  }
}

function ruleDetail(matchedRule: string | undefined, allowed: boolean): string {
  if (!matchedRule) return 'no robots.txt rule matched this path; default allow';
  return `matched "${matchedRule}"${allowed ? '' : ''}`;
}

function allow(
  reasonCode: ReasonCode,
  decidingSignal: DecidingSignal,
  reasonDetail: string,
  precedenceRule: string,
  groupSelectionBasis: GroupSelectionBasis,
  matchedGroupToken: string | null,
  aiTokensDisallowed: string[],
  crawlDelaySeconds: number | null,
  decidingRule: string | null,
): AccessDecision {
  return {
    allowed: true,
    reasonCode,
    reasonDetail,
    decidingSignal,
    decidingRule,
    decidingGroup: matchedGroupToken,
    precedenceRule,
    groupSelectionBasis,
    matchedGroupToken,
    aiTokensDisallowed,
    crawlDelaySeconds,
  };
}

function deny(
  reasonCode: ReasonCode,
  decidingSignal: DecidingSignal,
  reasonDetail: string,
  precedenceRule: string,
  groupSelectionBasis: GroupSelectionBasis = 'NO_GROUP',
  matchedGroupToken: string | null = null,
  decidingRule: string | null = null,
  crawlDelaySeconds: number | null = null,
  aiTokensDisallowed: string[] = [],
): AccessDecision {
  return {
    allowed: false,
    reasonCode,
    reasonDetail,
    decidingSignal,
    decidingRule,
    decidingGroup: matchedGroupToken,
    precedenceRule,
    groupSelectionBasis,
    matchedGroupToken,
    aiTokensDisallowed,
    crawlDelaySeconds,
  };
}
