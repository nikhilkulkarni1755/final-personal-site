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
import type { PageFetchOutcome, UseRights } from '../gate/types.ts';

export type { PageFetchOutcome } from '../gate/types.ts';

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
   * The page the gate already fetched.
   *
   * The gate MUST fetch the page itself to read X-Robots-Tag, meta robots and
   * tdm-reservation -- those signals only exist in the response -- so it hands
   * that response over and nothing fetches the URL again (D21/D22).
   *
   * This is W1's `PageFetchOutcome` verbatim, not a local restatement of it.
   * The first production run failed because I had guessed a `body_read` flag
   * that the shipped contract does not have: `body_read ? body : ''` read
   * undefined as false and threw away 388 KB of real HTML on every page of
   * every candidate. Importing the type makes that class of drift a compile
   * error instead of a silent empty crawl.
   */
  page: PageFetchOutcome;
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
