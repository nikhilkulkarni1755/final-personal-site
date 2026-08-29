/**
 * Shapes lane W5 (scoring & selection) speaks.
 *
 * The storage shapes -- VerdictRow, NewVerdict, Criterion, VerdictScore,
 * CitationStance, EvidenceRow -- belong to W3 and live in finds/types.ts. They
 * are imported, never redeclared. What is declared here is the layer above
 * them: the *judgment*, before it is flattened into rows.
 *
 * Both of the gaps this file used to work around are closed. W3 migrated
 * `stance = 'inconclusive'` and `finds_verdicts.rubric_version` (PR #25), so a
 * score of 1 can now cite the rows that settled nothing AS such, and the rules
 * that produced a score are stored beside it instead of smuggled into
 * `scored_by`.
 */

import type { CitationStance, Criterion, VerdictScore } from '../types.ts';

/* ========================================================================== */
/* citations -- the D7 substance                                               */
/* ========================================================================== */

/**
 * W3's CitationStance, re-exported under this lane's name so the criteria read
 * in their own vocabulary. It is the same type, not a parallel one.
 *
 * 'inconclusive' is not a hedge. It is the difference between "we read this
 * page and it disproves the claim" and "we read this page and it settled
 * nothing" -- and under Nikhil's first criterion those are not the same
 * finding at all.
 */
export type ScoreStance = CitationStance;

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
  /**
   * The pages were fetched, but the landing page came back as an unrendered
   * JS shell (W4's `spa_shell_not_rendered`, D24 keeps rendering OFF), so
   * there was no text to extract claims from. We could not READ the site.
   * Distinct from every other reason here: this is not the product being
   * quiet, it is us being unable to see it.
   */
  | 'not_rendered'
  /** The candidate has not been crawled yet. Not a finding, just a queue state. */
  | 'no_evidence'
  /** Evidence exists, but W4 recorded no claims diff in it, so C1 has no
   *  left-hand side to check. Distinct from "checked and found nothing". */
  | 'no_claims_extracted';

export type ScoreOutcome =
  | { kind: 'scored'; candidate_id: string; evidence_run_id: string; scores: CriterionScore[] }
  | { kind: 'unscoreable'; candidate_id: string; reason: UnscoreableReason; detail: string };
