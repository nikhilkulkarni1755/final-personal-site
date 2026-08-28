/**
 * Shapes lane W5 (scoring & selection) speaks.
 *
 * The storage shapes -- VerdictRow, NewVerdict, Criterion, VerdictScore,
 * CitationStance, EvidenceRow -- belong to W3 and live in finds/types.ts. They
 * are imported, never redeclared. What is declared here is the layer above
 * them: the *judgment*, before it is flattened into rows.
 *
 * Two things in here are deliberately richer than what W3's schema can store
 * today, and both are open proposals to the coordinator rather than local
 * inventions (see lanes/W5.md):
 *
 *   1. `ScoreStance` has a third value, 'inconclusive'. finds_verdict_evidence
 *      allows only supports|contradicts, so an evidence row that was read and
 *      settled nothing cannot currently be cited as such. That is exactly the
 *      row a score of 1 has to point at.
 *   2. `rubric_version` is a first-class field. finds_verdicts has no such
 *      column (finds_crawl_verdicts does). Until it gains one it travels
 *      inside `scored_by`; see rubric.ts.
 */

import type { Criterion, VerdictScore } from '../types.ts';

/* ========================================================================== */
/* citations -- the D7 substance                                               */
/* ========================================================================== */

/**
 * A superset of W3's CitationStance.
 *
 * 'inconclusive' is not a hedge. It is the difference between "we read this
 * page and it disproves the claim" and "we read this page and it settled
 * nothing" -- and under Nikhil's first criterion those are not the same
 * finding at all. persist.ts refuses to write one rather than mislabelling it
 * as 'supports'.
 */
export type ScoreStance = 'supports' | 'contradicts' | 'inconclusive';

/** One cited evidence row. `evidence_id` is a real finds_evidence.id. */
export interface ScoreCitation {
  evidence_id: string;
  stance: ScoreStance;
  /**
   * Why this row was cited, in one line. Not a substitute for the citation --
   * it is the pointer that makes a 40-row citation list readable.
   */
  note: string;
}

/* ========================================================================== */
/* C1 -- a three-way distinction, not a number                                 */
/* ========================================================================== */

/**
 * C1 is "whatever is being advertised is true", and collapsing it to a scalar
 * loses the thing that was actually asked for.
 *
 *   'corroborated'    a claim was checked against another page and holds
 *   'contradicted'    a claim is contradicted by evidence we hold
 *   'unsubstantiated' no corroborating evidence either way
 *
 * UNSUBSTANTIATED IS NOT FALSE. A small honest project with thin docs is not a
 * liar, and scoring it as one would be the single worst failure this lane can
 * commit. It maps to score 1 ("no evidence either way"), never to 0.
 *
 * CONTRADICTED, conversely, is disqualifying however well the product scores
 * elsewhere. Shipping Nikhil something that lies poisons the whole feed.
 */
export type C1Status = 'corroborated' | 'contradicted' | 'unsubstantiated';

/* ========================================================================== */
/* a scored criterion                                                          */
/* ========================================================================== */

/** What the corpus actually was, so a score can be read in context. */
export interface CorpusStats {
  /** finds_evidence rows in this crawl generation. */
  pages_read: number;
  /** Of those, how many the origin answered 2xx for. */
  pages_ok: number;
  /**
   * URLs the gate refused. Supplied by the caller from finds_crawl_verdicts;
   * a refusal can never be a finds_evidence row (the composite FK pins
   * allowed=true), so it is invisible from evidence alone.
   */
  urls_refused: number;
}

/** One criterion, scored, with everything needed to audit the score. */
export interface CriterionScore {
  criterion: Criterion;
  score: VerdictScore;
  /** Present for C1 only: the three-way distinction the score flattens. */
  status?: C1Status;
  rationale: string;
  /** Non-empty by construction. An empty list is a bug, and the DB agrees. */
  citations: ScoreCitation[];
  rubric_version: string;
}

/* ========================================================================== */
/* the outcome of trying to score a candidate                                  */
/* ========================================================================== */

/**
 * Why a candidate produced no verdict. None of these is a low score, and
 * flattening any of them into one would be the D6 violation: an invented
 * verdict standing in for an honest non-evaluation.
 */
export type UnscoreableReason =
  /** R2 §3.2 / DECISIONS D12: ai-input reserved, so C1-C4 cannot be evaluated
   *  AT ALL. ~19% of launches land here. The candidate is 'not_evaluable',
   *  never 'rejected'. */
  | 'not_evaluable'
  /** The gate denied every URL, so there is no evidence generation to score. */
  | 'gate_denied'
  /** The candidate has not been crawled yet. Not a finding, just a queue state. */
  | 'no_evidence'
  /** Evidence exists, but W4 recorded no claims diff in it, so C1 has no
   *  left-hand side to check. Distinct from "checked and found nothing". */
  | 'no_claims_extracted';

export type ScoreOutcome =
  | { kind: 'scored'; candidate_id: string; evidence_run_id: string; scores: CriterionScore[] }
  | { kind: 'unscoreable'; candidate_id: string; reason: UnscoreableReason; detail: string };
