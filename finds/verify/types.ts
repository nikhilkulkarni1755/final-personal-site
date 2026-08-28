/**
 * Shapes lane W4 speaks that are W4's own.
 *
 * Everything that touches the database comes from finds/types.ts, which W3
 * owns and which is now complete for the pipeline -- `NewEvidence`,
 * `NewCrawlVerdict`, `GateReasonCode`, `GateUseRights`, `GateCrawlBudget` are
 * imported, never redeclared. What is left here is the two things that exist
 * only inside a crawl: the gate's answer as W4 consumes it, and the outcome of
 * one gated fetch.
 */

import type { GateCrawlBudget, GateDecidingSignal, GateReasonCode } from '../types.ts';
import type { UseRights } from '../gate/types.ts';

export type {
  EvidenceClaim,
  EvidenceObservation,
  EvidencePageRole,
  EvidenceQuote,
  GateCrawlBudget,
  GateDecidingSignal,
  GateReasonCode,
  GateUseRights,
  NewCrawlEvidence,
  NewCrawlVerdict,
  NewEvidence,
} from '../types.ts';

/**
 * One gate decision, as W4 reads it.
 *
 * A superset of what `finds_crawl_verdicts` stores, minus the parts that are
 * W1's provenance rather than W4's input. Anything the gate did not say is
 * null and stays null: W4 does not substitute the value R2 says it would have
 * been, because a fabricated reason code is a lie about why we crawled someone,
 * and that is the exact question the verdict object exists to answer.
 */
export interface GateDecision {
  url: string;
  /** scheme://host[:port] -- R2 §1.2, the cache key. */
  authority: string;
  allowed: boolean;
  reason_code: GateReasonCode | null;
  /** Human-readable, from the gate verbatim. Never composed by W4. */
  reason_detail: string;
  deciding_signal: GateDecidingSignal | null;
  /** The literal robots.txt line, when the gate named one. */
  deciding_rule: string | null;
  deciding_group: string | null;
  precedence_rule: string | null;
  /**
   * Null when the gate did not compute the USE lattice. Null is NOT
   * "permissive" -- it is recorded as unknown and W5 decides what an unknown
   * costs. Only an explicit `false` makes W4 change its own behaviour.
   */
  /**
   * As the gate emitted it.
   *
   * Typed against W1's `UseRights` rather than W3's `GateUseRights` because
   * the two disagree: W3 (following R2 §6) requires `reserved_by[].restricts`,
   * naming which operations each signal restricted, and W1 does not emit it.
   * W4 passes through what the gate actually said and does not synthesise the
   * missing field -- inventing audit data is worse than a gap in it. Raised
   * with the coordinator for W1 or W3 to settle.
   *
   * Null means the gate did not compute the lattice, which is NOT "permissive".
   * Only an explicit `false` changes what W4 does.
   */
  use_rights: UseRights | null;
  crawl_budget: GateCrawlBudget;
  robots: Record<string, unknown>;
  rubric_version: string;
  gate_version: string;
  decided_at: string;
  expires_at: string | null;

  /**
   * How many HTTP requests the gate issued to reach this decision, from the
   * evidence entries it reports. W4 does not enforce anything with this --
   * D22 puts the cap in the gate -- it is recorded so a crawl's real cost to a
   * site is visible in the evidence rather than inferred.
   */
  gate_requests: number;

  /**
   * The page body the gate already fetched, when it hands it over.
   *
   * The gate MUST fetch the page itself to read X-Robots-Tag, meta robots and
   * tdm-reservation -- those signals only exist in the response. So when W4
   * fetched it a second time for the body, every URL was requested twice, ~170
   * ms apart, inside a 2 s sleep that only spaced the pairs. Null means the
   * gate did not hand a body over and W4 must fetch it, which is the old
   * two-request behaviour and is reported as such.
   */
  page: GatePageBody | null;
}

/** A response the gate already has, so nobody fetches it twice. */
export interface GatePageBody {
  final_url: string;
  http_status: number;
  content_type: string | null;
  /** Empty when `body_read` is false. Never a substitute for the real body. */
  body: string;
  /** False when the gate did not read the body (unaccepted content type). */
  body_read: boolean;
  sha256: string | null;
  truncated: boolean;
  fetched_at: string;
  elapsed_ms: number;
}

/**
 * Every fetch W4 attempts ends in one of these, and every one of them is
 * recordable as evidence. There is no fourth outcome and no silent skip:
 * D6 means "we could not read it" is a finding, not an absence.
 */
export type FetchOutcome =
  /** The gate said no. Zero bytes left this process. */
  | { kind: 'refused'; url: string; decision: GateDecision }
  /** The gate said yes and the origin answered. Includes 404s and 500s. */
  | {
      kind: 'fetched';
      url: string;
      decision: GateDecision;
      /** After redirects. Differs from `url` when the origin moved us. */
      final_url: string;
      http_status: number;
      content_type: string | null;
      body: string;
      content_sha256: string;
      /** True when the R2 §5.3 2 MB per-response cap cut the body short. */
      truncated: boolean;
      fetched_at: string;
      elapsed_ms: number;
    }
  /** The gate said yes and the transport failed. Also evidence. */
  | {
      kind: 'error';
      url: string;
      decision: GateDecision;
      error: string;
      fetched_at: string;
      elapsed_ms: number;
    };
