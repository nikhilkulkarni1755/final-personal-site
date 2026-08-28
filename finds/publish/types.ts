/**
 * Shapes lane W11 (the publish path) speaks.
 *
 * The storage shapes -- PublishedFindRow, PublishedCitation, Criterion,
 * VerdictScore, CitationStance, GateUseRights -- belong to W3 and live in
 * finds/types.ts. They are imported, never redeclared.
 *
 * What is declared here is the layer W3 has not shipped yet: the INSERT shape
 * for finds_published, and the private rows the snapshot is built from.
 * Per DECISIONS D8's general rule, a lane that needs a shape which does not
 * exist declares it locally, names it after the table DEPENDENCIES.md already
 * names, and flags it to the coordinator. `NewPublishedFind` is proposed for
 * finds/types.ts; see finds-coord/lanes/W11.md.
 */

import type {
  Criterion,
  GateUseRights,
  PublishedCitation,
  PublishedFindRow,
  Timestamp,
  VerdictScore,
} from '../types.ts';

/**
 * The INSERT shape for finds_published. Everything the table generates
 * (id, created_at, updated_at) is omitted; `published_at` is present and
 * nullable because it IS the visibility switch, not a bookkeeping column --
 * null means drafted, a future value means scheduled, and both are invisible
 * to anon by RLS.
 */
export type NewPublishedFind = Omit<PublishedFindRow, 'id' | 'created_at' | 'updated_at'>;

/**
 * One citation as it will appear on the page, plus the USE rights of the page
 * it came from. The rights are NOT published -- they decide what may be.
 *
 * R2's rubric splits ACCESS from USE: a page we were allowed to FETCH may
 * still carry `publish_excerpt: false` (a `nosnippet`, a `Content-Signal:
 * search=no`) or `publish_link: false`. W11 is the only lane that can honour
 * that, because it is the only lane that publishes anything.
 */
export interface CandidateCitation extends PublishedCitation {
  /** The gate's USE decision for the page this quote came from. */
  use_rights: GateUseRights | Record<string, never> | null;
}

/** One criterion's score on the generation being published. */
export interface CandidateScore {
  criterion: Criterion;
  score: VerdictScore;
}

/**
 * Everything the snapshot is built from: the private pipeline rows for ONE
 * candidate, read at publish time. Deliberately flat and deliberately inert --
 * `buildSnapshot` is pure, so every refusal below is testable without a
 * database and without a credential.
 */
export interface PublishSource {
  candidate: {
    id: string;
    name: string;
    tagline: string | null;
    /** What the candidate controls. The D23 scope check is derived from it. */
    product_url: string;
    first_seen_at: Timestamp;
  };
  /** Display names of the platforms it was seen on. Non-empty by CHECK. */
  source_labels: string[];
  /** The crawl generation whose verdicts and evidence are being published. */
  evidence_run_id: string;
  scores: CandidateScore[];
  citations: CandidateCitation[];
}
