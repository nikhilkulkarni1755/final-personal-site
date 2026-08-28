/**
 * The single seam between W4 and W1's permission gate.
 *
 * W4 may not fetch a byte except through the gate (DEPENDENCIES.md, W1 -> W4),
 * and since W3 shipped `finds_evidence`'s composite FK on (id, allowed) the
 * database enforces it too. This module is the whole of W4's knowledge of how
 * to ask. It contains no policy: it does not parse robots.txt, does not know
 * what an AI-crawler token is, and cannot produce an ALLOW on its own.
 *
 * The gate's `GateVerdict` already IS R2 §6's verdict object, so this adapts
 * almost nothing. What it does add is two things W4 needs on its side:
 *
 *   - one `RunState` per crawl, threaded through every check, so that P2/P3
 *     work. Without it an origin that refuses us on page 3 is re-asked on
 *     pages 4 through 25.
 *   - a refusal to act on an ALLOW that names no rule. The gate always names
 *     one today; if a future change stops naming one, W4 stops rather than
 *     quietly treating an unexplained yes as a yes.
 */

import { createRunState, recordAuthorityDenial } from '../gate/access.ts';
import type { RunState } from '../gate/access.ts';
import { checkPage } from '../gate/gate.ts';
import type { GateVerdict } from '../gate/types.ts';
import { R2_CAPS } from './config.ts';
import type { GateCrawlBudget, GateDecision, GatePageBody } from './types.ts';

export { createRunState };
export type { RunState };

/**
 * Clamp to R2 §5.3. The gate's numbers win when they are stricter; R2's caps
 * win when they are not. W4 never crawls harder than the rubric permits, even
 * if a gate hands it a looser budget -- being wrong in that direction is the
 * one that hurts somebody else's server, and bot.txt promises these exact
 * numbers under Nikhil's name.
 */
function clampBudget(fromGate: Partial<GateCrawlBudget> | null): GateCrawlBudget {
  return {
    delay_ms: Math.max(fromGate?.delay_ms ?? 0, R2_CAPS.minDelayMs),
    delay_source: fromGate?.delay_source ?? 'DEFAULT',
    page_cap: Math.min(fromGate?.page_cap ?? R2_CAPS.maxPages, R2_CAPS.maxPages),
    depth_cap: Math.min(fromGate?.depth_cap ?? R2_CAPS.maxDepth, R2_CAPS.maxDepth),
    wall_clock_ms: Math.min(fromGate?.wall_clock_ms ?? R2_CAPS.wallClockMs, R2_CAPS.wallClockMs),
  };
}

/**
 * The response the gate already fetched, if this build of the gate hands it
 * over. Optional on purpose: W4 must work against a gate that does not yet,
 * and must say so rather than silently fetching twice.
 */
function pageFrom(verdict: GateVerdict): GatePageBody | null {
  const page = (verdict as GateVerdict & { page?: GatePageBody | null }).page;
  return page ?? null;
}

function adapt(verdict: GateVerdict): GateDecision {
  if (verdict.allowed && !verdict.reason_code) {
    throw new Error(
      `The gate allowed ${verdict.url} without naming which R2 §6.1 rule allowed it. W4 does not act ` +
        `on an unexplained ALLOW: "why did you crawl me" is the question the verdict object exists to answer.`,
    );
  }
  return {
    url: verdict.url,
    authority: verdict.authority,
    allowed: verdict.allowed,
    reason_code: verdict.reason_code,
    reason_detail: verdict.reason_detail,
    deciding_signal: verdict.deciding_signal,
    deciding_rule: verdict.deciding_rule,
    deciding_group: verdict.deciding_group,
    precedence_rule: verdict.precedence_rule,
    use_rights: verdict.use_rights,
    crawl_budget: clampBudget(verdict.crawl_budget),
    robots: verdict.robots as unknown as Record<string, unknown>,
    rubric_version: verdict.rubric_version,
    gate_version: verdict.gate_version,
    decided_at: verdict.decided_at,
    expires_at: verdict.expires_at,
    // One evidence entry per request the gate made. Reported by the gate, not
    // inferred from what we think it does.
    gate_requests: verdict.evidence.length,
    page: pageFrom(verdict),
  };
}

/** Ask the gate about one URL, inside this crawl's run state. */
export interface DecideOptions {
  candidateId?: string;
  /**
   * The project's own authority, for P1's same-site check (V2-C4, D23).
   *
   * This is the input that makes that half of P1 do any work. The gate falls
   * back to the URL's own origin when it is omitted, which compares a value
   * with itself and is always true -- honest as a standalone default, useless
   * as a protection. W4 is the caller that has a real project to compare
   * against, so W4 is the caller that must supply it.
   */
  candidateOrigin?: string;
}

export async function decide(url: string, runState: RunState, options: DecideOptions = {}): Promise<GateDecision> {
  return adapt(
    await checkPage(url, {
      candidateId: options.candidateId ?? null,
      candidateOrigin: options.candidateOrigin,
      runState,
    }),
  );
}

/**
 * Tell the gate that an authority refused us, so P2/P3 protect the rest of the
 * run. R2 §3.6: "Homepage 200, /pricing 403 -> that URL DENY; whole origin DENY
 * for the rest of the run." The gate cannot see this on its own -- W4 makes the
 * page fetches -- so reporting it back is W4's obligation, not an optimisation.
 */
export function reportRefusal(runState: RunState, authority: string, status: number, detail: string): void {
  recordAuthorityDenial(runState, authority, {
    reasonCode: status === 429 ? 'origin_rate_limited' : 'origin_blocked_us',
    decidingSignal: status === 429 ? 'RATE_LIMIT' : 'HTTP_STATUS',
    detail,
  });
}
