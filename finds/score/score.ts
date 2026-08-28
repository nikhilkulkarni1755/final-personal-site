/**
 * The lane's entry point: one candidate, one crawl generation, four criteria.
 *
 * Its whole job is to make sure a NON-EVALUATION never becomes a low score.
 * There are four distinct ways a candidate can produce no verdict and every
 * one of them is a real, common outcome rather than an edge case:
 *
 *   not_evaluable      R2 §3.2 -- the site reserves ai-input, so C1-C4 cannot
 *                      be evaluated AT ALL. R2 measured ~19% of launches land
 *                      here (DECISIONS D12). NOT a rejection, and the schema
 *                      agrees: finds_candidates.status has its own value.
 *   gate_denied        the permission gate refused every URL, so there is no
 *                      evidence generation to score.
 *   no_evidence        not crawled yet. A queue state, not a finding.
 *   no_claims_extracted  crawled, but the criterion's collection pass left no
 *                      observation -- so we never checked, which is not the
 *                      same as checking and finding nothing.
 *
 * A candidate may also be PARTLY scored: three criteria came back and one
 * could not. That is returned as-is rather than patched with a default,
 * because a default IS an invented verdict (D6). Selection then sets it aside
 * as `incomplete_scores` rather than ranking it as though it had lost.
 */

import type { CandidateStatus, EvidenceRow } from '../types.ts';
import type { ScoreOutcome, UnscoreableReason } from './types.ts';
import { generation } from './rubric.ts';
import { scoreC1 } from './c1.ts';
import { scoreC2 } from './c2.ts';
import { scoreC3 } from './c3.ts';
import { scoreC4 } from './c4.ts';

export interface ScoreInput {
  candidate_id: string;
  /** From finds_candidates. Two of its values stop scoring before it starts. */
  candidate_status: CandidateStatus;
  /** Which generation to score. Rows of any other run are ignored, not mixed. */
  evidence_run_id: string;
  rows: readonly EvidenceRow[];
  /**
   * URLs the gate refused for this candidate, from finds_crawl_verdicts. Enters
   * rationales only; a site that showed us less is not thereby a worse product.
   */
  urls_refused?: number;
}

const BLOCKED: Partial<Record<CandidateStatus, { reason: UnscoreableReason; detail: string }>> = {
  not_evaluable: {
    reason: 'not_evaluable',
    detail:
      'The site reserves ai-input (R2 §3.2), so C1-C4 cannot be evaluated at all. This is a non-evaluation ' +
      'recorded honestly, never a low score and never a rejection -- R2 measured ~19% of launches land here.',
  },
  gate_blocked: {
    reason: 'gate_denied',
    detail:
      'The permission gate refused every URL for this candidate, so no evidence generation exists to score. ' +
      'We do not read what we are told not to read, and we do not guess at what we did not read.',
  },
};

/** Score one candidate's crawl generation. Pure: same input, same output. */
export function scoreCandidate(input: ScoreInput): ScoreOutcome {
  const blocked = BLOCKED[input.candidate_status];
  if (blocked) {
    return { kind: 'unscoreable', candidate_id: input.candidate_id, ...blocked };
  }

  const rows = generation(input.rows, input.evidence_run_id);
  if (rows.length === 0) {
    return {
      kind: 'unscoreable',
      candidate_id: input.candidate_id,
      reason: 'no_evidence',
      detail: `No finds_evidence rows for crawl generation ${input.evidence_run_id}.`,
    };
  }

  const refused = input.urls_refused ?? 0;
  const results = [scoreC1(rows, refused), scoreC2(rows, refused), scoreC3(rows, refused), scoreC4(rows, refused)];
  const scores = results.flatMap((result) => (result.kind === 'scored' ? [result.score] : []));

  if (scores.length === 0) {
    const first = results[0];
    return {
      kind: 'unscoreable',
      candidate_id: input.candidate_id,
      reason: first.kind === 'unscoreable' ? first.reason : 'no_claims_extracted',
      detail:
        `${rows.length} evidence row(s) exist but no criterion could be scored from them. ` +
        (first.kind === 'unscoreable' ? first.detail : ''),
    };
  }

  return { kind: 'scored', candidate_id: input.candidate_id, evidence_run_id: input.evidence_run_id, scores };
}
