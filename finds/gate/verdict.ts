// Verdict record builder.
//
// Combines the three signal sources (robots.txt, X-Robots-Tag, meta robots)
// into one PathVerdict, applying config.signalPrecedence and
// config.disallowDirectiveTokens. This is the ONE place the signals are
// combined -- robots.ts / headers.ts / metaRobots.ts each only read their
// own signal and stay silent on what it means for the final answer.
//
// Fail-closed rule: if robots.txt itself was unreachable (server error /
// network failure, as opposed to a clean "no robots.txt" 4xx), we cannot
// establish permission at all, so the verdict is "not allowed" regardless
// of what the other signals say.

import { GATE_CONFIG } from './config.ts';
import { matchPath, selectGroup } from './robots.ts';
import type { ParsedRobots, PathVerdict } from './types.ts';

export interface PageSignals {
  headerDirectives: string[];
  metaDirectives: string[];
  /** False only when robots.txt was UNREACHABLE (5xx/network), not when it
   * simply doesn't exist (4xx) -- see robots.ts fetch semantics. */
  robotsReachable: boolean;
}

function directiveVerdict(
  directives: string[],
  source: 'x-robots-tag' | 'meta-robots',
): PathVerdict | null {
  const hit = directives.find((d) => (GATE_CONFIG.disallowDirectiveTokens as readonly string[]).includes(d));
  if (!hit) return null;
  return {
    path: '',
    allowed: false,
    reason: `${source} directive "${hit}" is on the disallow list`,
    source,
    matchedRule: hit,
  };
}

export function buildVerdict(
  path: string,
  parsedRobots: ParsedRobots,
  signals: PageSignals,
): PathVerdict {
  if (!signals.robotsReachable) {
    return {
      path,
      allowed: false,
      reason: 'robots.txt was unreachable (server error or network failure); failing closed',
      source: 'default',
    };
  }

  const bySource: Partial<Record<(typeof GATE_CONFIG.signalPrecedence)[number], PathVerdict>> = {
    'x-robots-tag': directiveVerdict(signals.headerDirectives, 'x-robots-tag') ?? undefined,
    'meta-robots': directiveVerdict(signals.metaDirectives, 'meta-robots') ?? undefined,
  };

  const group = selectGroup(parsedRobots.groups, GATE_CONFIG.userAgentProductToken);
  const robotsMatch = matchPath(group, path);
  bySource['robots-txt'] = {
    path,
    allowed: robotsMatch.allowed,
    reason: robotsMatch.matchedRule
      ? `robots.txt rule "${robotsMatch.matchedRule}" applies`
      : 'no robots.txt rule matched this path; default allow',
    source: 'robots-txt',
    matchedRule: robotsMatch.matchedRule,
  };

  // Walk precedence order; the first source with a DISALLOW verdict wins
  // (any one signal saying no is enough to say no). If every source that
  // fired says allow, the verdict is allow, attributed to whichever source
  // actually spoke (robots-txt always speaks; header/meta only speak when a
  // listed directive was present).
  for (const src of GATE_CONFIG.signalPrecedence) {
    const v = bySource[src];
    if (v && !v.allowed) return { ...v, path };
  }
  for (const src of GATE_CONFIG.signalPrecedence) {
    const v = bySource[src];
    if (v) return { ...v, path };
  }

  // Unreachable: robots-txt always produces a verdict above, so this is
  // dead code -- but fail closed rather than throw if precedence is
  // reconfigured to omit it.
  return { path, allowed: false, reason: 'no signal source produced a verdict', source: 'default' };
}
