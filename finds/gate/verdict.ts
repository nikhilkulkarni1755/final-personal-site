// Assembles the final GateVerdict (§6) from an AccessDecision (access.ts),
// a UseRights (use.ts, when allowed), and robots.txt provenance -- plus the
// §7 TTL table, which this module is the one place that reads.
//
// Two caching layers exist for a reason R2's table is a little ambiguous
// about: the table's TTLs are phrased per FINAL VERDICT CLASS (e.g.
// "robots_disallow: 24h"), but many different paths share one robots.txt
// document, and the document itself has no allow/deny meaning until matched
// against a path. gate.ts therefore caches at two levels:
//   1. the robots.txt OUTCOME per authority (are we even allowed to keep
//      talking to this origin, and is its policy file fresh?) -- ttlForRobotsOutcome().
//   2. the full per-URL GateVerdict, once computed -- ttlForReasonCode(),
//      which is R2's table read literally. A cached verdict hit skips
//      re-deriving anything, robots.txt document included.

import { GATE_CONFIG } from './config.ts';
import type { ReasonCode } from './config.ts';
import type { RobotsOutcome } from './types.ts';

/** §7's table, read literally. Returns null only for manual_denylist,
 * which never expires (a human decided; only a human undoes it). */
export function ttlForReasonCode(reasonCode: ReasonCode): number | null {
  switch (reasonCode) {
    case 'manual_denylist':
      return null;
    case 'robots_exact_group':
    case 'robots_allow':
    case 'robots_wildcard_allow':
    case 'robots_no_rules':
    case 'robots_absent':
    case 'robots_soft_404':
    case 'robots_redirect_loop':
      return GATE_CONFIG.ttl.allowMs;
    case 'robots_disallow':
    case 'robots_wildcard_disallow':
    case 'ai_block_inferred':
      return GATE_CONFIG.ttl.denyRobotsMs;
    case 'robots_server_error':
    case 'robots_unreachable':
      return GATE_CONFIG.ttl.denyUnreachableMs;
    case 'robots_forbidden':
    case 'robots_rate_limited':
    case 'robots_bad_success':
    case 'bot_challenge':
    case 'origin_blocked_us':
    case 'origin_rate_limited':
      return GATE_CONFIG.ttl.denyBlockedMs;
    case 'url_out_of_scope':
    case 'unhandled_case':
      return GATE_CONFIG.ttl.unhandledMs;
  }
}

/** Freshness bound for the robots.txt DOCUMENT itself (see file header --
 * this is inferred from §7's spirit, not a literal row, since a document
 * has no allow/deny meaning before it's matched against a path). */
export function ttlForRobotsOutcome(outcome: RobotsOutcome): number {
  if (outcome.kind === 'parsed' || outcome.kind === 'absent') return GATE_CONFIG.ttl.allowMs;
  if (outcome.reasonCode === 'robots_server_error' || outcome.reasonCode === 'robots_unreachable') {
    return GATE_CONFIG.ttl.denyUnreachableMs;
  }
  return GATE_CONFIG.ttl.denyBlockedMs; // robots_forbidden / robots_rate_limited / robots_bad_success / bot_challenge
}

export function expiresAt(reasonCode: ReasonCode, decidedAt: Date): string | null {
  const ttl = ttlForReasonCode(reasonCode);
  return ttl === null ? null : new Date(decidedAt.getTime() + ttl).toISOString();
}
