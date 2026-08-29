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
import { findings, generation } from './rubric.ts';
import type { NoveltyJudgement } from './novelty.ts';
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
  /**
   * C2's novelty judgement (D37/D38). Null or absent means no judgement was
   * obtained, which scoreC2 turns into 1 -- never into 0. Passed IN rather
   * than fetched here so this function stays pure and testable; see the
   * determinism carve-out in c2.ts.
   */
  novelty?: NoveltyJudgement | null;
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

  // ---- A SITE WE COULD NOT READ IS NOT A SITE THAT SAID NOTHING. ----------
  //
  // With rendering off (D24), a JS app's landing page comes back as an empty
  // shell. W4 records that honestly as `spa_shell_not_rendered` and extracts
  // no claims from it -- so C1 has no left-hand side and is unscoreable.
  //
  // But C2/C3/C4 are collected by pattern-matching over the corpus, and
  // W4's collectors record an ABSENCE explicitly whenever a pattern misses.
  // Over an empty shell every pattern misses, so the evidence would carry a
  // full set of `*_absent` observations and this lane would happily write
  // three verdicts of 1: "no evidence either way" for a free tier, for an
  // API, for a problem statement. Every one of those would be a finding about
  // a page we never received.
  //
  // That is the difference between an honest omission and a false accusation,
  // and it is the whole reason this branch exists. No verdict is written; the
  // candidate keeps its 'crawled' status, so a later render-enabled re-crawl
  // produces a new generation and it is scored properly then.
  const shell = findings(rows, 'spa_shell_not_rendered');
  const claimsDiff = findings(rows, 'c1_corroborated', 'c1_contradicted', 'c1_unsubstantiated');
  if (shell.length > 0 && claimsDiff.length === 0) {
    return {
      kind: 'unscoreable',
      candidate_id: input.candidate_id,
      reason: 'not_rendered',
      detail:
        `The landing page returned an unrendered JS shell, so no claim could be extracted from it ` +
        `(${shell.length} page(s) affected; rendering is off per D24). The C2/C3/C4 collectors would ` +
        'still report every pattern as absent, but an absence measured over a page we never received ' +
        'is not evidence about the product. Nothing is scored. A re-crawl with rendering enabled ' +
        'produces a new generation and this candidate is scored from that.',
    };
  }

  const refused = input.urls_refused ?? 0;
  const results = [
    scoreC1(rows, refused),
    scoreC2(rows, input.novelty ?? null, refused),
    scoreC3(rows, refused),
    scoreC4(rows, refused),
  ];
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
