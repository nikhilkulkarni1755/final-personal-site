/**
 * The single seam between W4 and W1's permission gate.
 *
 * W4 may not fetch a byte except through the gate (DEPENDENCIES.md, W1 -> W4).
 * This module is the whole of W4's knowledge of how to ask. It contains no
 * policy: it does not parse robots.txt, does not know what an AI-crawler token
 * is, and cannot produce an ALLOW on its own. If the gate module is missing or
 * throws, this throws, and nothing downstream fetches anything.
 *
 * The gate is loaded by dynamic import rather than a static one for a single
 * reason: `finds/gate/**` is W1's and has not merged into main yet, so a static
 * import would make this whole lane untypecheckable and unrunnable until it
 * does. Point FINDS_GATE_MODULE at a checkout of W1's branch to integration-test
 * before the merge; leave it unset and the default resolves to the sibling
 * directory, which is where the gate lives once W1 lands.
 */

import { R2_CAPS } from './config.ts';
import type { GateCrawlBudget, GateDecision, GateReasonCode, GateDecidingSignal } from './types.ts';

/** Absolute path or specifier of W1's gate module. */
function gateSpecifier(): string {
  return process.env.FINDS_GATE_MODULE ?? new URL('../gate/gate.ts', import.meta.url).href;
}

interface GateModule {
  checkPage(url: string): Promise<unknown>;
}

/** Keyed on the specifier, so pointing FINDS_GATE_MODULE elsewhere really does. */
const cached = new Map<string, GateModule>();

export async function loadGate(): Promise<GateModule> {
  const specifier = gateSpecifier();
  const hit = cached.get(specifier);
  if (hit) return hit;
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch (cause) {
    throw new Error(
      `W4 cannot reach the permission gate at ${specifier}. W4 is forbidden from ` +
        `fetching any page without a gate decision, so this is fatal, not a fallback. ` +
        `Set FINDS_GATE_MODULE to a checkout of W1's finds/gate/gate.ts.`,
      { cause },
    );
  }
  const candidate = mod as Partial<GateModule>;
  if (typeof candidate.checkPage !== 'function') {
    throw new Error(`${specifier} does not export checkPage(); it is not the permission gate.`);
  }
  cached.set(specifier, candidate as GateModule);
  return candidate as GateModule;
}

/* -------------------------------------------------------------------------- */
/* adapting whatever the gate returned                                         */
/* -------------------------------------------------------------------------- */

/**
 * Clamp to R2 §5.3. The gate's numbers win when they are stricter; R2's caps
 * win when they are not. W4 never crawls harder than the rubric permits, even
 * if a gate hands it a looser budget -- being wrong in that direction is the
 * one that hurts somebody else's server.
 */
function clampBudget(fromGate: Partial<GateCrawlBudget> | undefined): GateCrawlBudget {
  return {
    delay_ms: Math.max(fromGate?.delay_ms ?? 0, R2_CAPS.minDelayMs),
    page_cap: Math.min(fromGate?.page_cap ?? R2_CAPS.maxPages, R2_CAPS.maxPages),
    depth_cap: Math.min(fromGate?.depth_cap ?? R2_CAPS.maxDepth, R2_CAPS.maxDepth),
    wall_clock_ms: Math.min(fromGate?.wall_clock_ms ?? R2_CAPS.wallClockMs, R2_CAPS.wallClockMs),
  };
}

/** R2 §6 verdict object, as W1 will emit it once the rubric is wired in. */
interface RubricVerdict {
  allowed: boolean;
  reason_code: GateReasonCode;
  reason_detail?: string;
  deciding_signal?: GateDecidingSignal;
  use_rights?: GateDecision['use_rights'];
  crawl_budget?: Partial<GateCrawlBudget>;
  robots?: { sitemaps?: string[] };
  gate_version?: string;
}

/** W1's pre-rubric shape (finds/gate/types.ts, `AuditRecord`). */
interface AuditRecord {
  verdict: { allowed: boolean; reason: string; source: string; matchedRule?: string };
  site?: { crawlDelayMs?: number; sitemaps?: string[] };
}

function isRubricVerdict(v: unknown): v is RubricVerdict {
  return typeof v === 'object' && v !== null && 'reason_code' in v;
}

function isAuditRecord(v: unknown): v is AuditRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as AuditRecord).verdict === 'object' &&
    typeof (v as AuditRecord).verdict?.allowed === 'boolean'
  );
}

/**
 * Ask the gate about one URL.
 *
 * Anything the gate did not tell us stays null. In particular a pre-rubric gate
 * supplies no `reason_code` and no USE lattice, and W4 records those as unknown
 * rather than inventing the values R2 says they would have been (D6).
 */
export async function decide(url: string): Promise<GateDecision> {
  const gate = await loadGate();
  const raw = await gate.checkPage(url);
  const decided_at = new Date().toISOString();
  const authority = new URL(url).origin;

  if (isRubricVerdict(raw)) {
    return {
      url,
      authority,
      allowed: raw.allowed,
      reason_code: raw.reason_code,
      reason_detail: raw.reason_detail ?? '',
      deciding_signal: raw.deciding_signal ?? null,
      use_rights: raw.use_rights ?? null,
      crawl_budget: clampBudget(raw.crawl_budget),
      sitemaps: raw.robots?.sitemaps ?? [],
      gate_version: raw.gate_version ?? 'unspecified',
      decided_at,
    };
  }

  if (isAuditRecord(raw)) {
    return {
      url,
      authority,
      allowed: raw.verdict.allowed,
      reason_code: null,
      reason_detail: raw.verdict.reason,
      deciding_signal: null,
      use_rights: null,
      crawl_budget: clampBudget({ delay_ms: raw.site?.crawlDelayMs }),
      sitemaps: raw.site?.sitemaps ?? [],
      gate_version: 'pre-rubric gate (no reason_code, no use_rights)',
      decided_at,
    };
  }

  throw new Error(
    `The gate returned a shape W4 does not recognise for ${url}. W4 will not guess ` +
      `whether that meant yes. Received: ${JSON.stringify(raw)?.slice(0, 300)}`,
  );
}
