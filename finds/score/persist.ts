/**
 * Building the one thing a verdict may be written as.
 *
 * D7 is enforced by a DEFERRABLE INITIALLY DEFERRED constraint trigger that
 * fires at COMMIT, so a verdict and its citations must go out in ONE
 * transaction. Under D17 every lane reaches the database through supabase-js,
 * i.e. PostgREST -- one transaction per HTTP request. Two calls would commit
 * the verdict alone, the deferred trigger would fire against it uncited, and
 * the whole thing would abort. That is the schema working exactly as designed;
 * it means the write cannot be expressed as two requests, and it is why this
 * lane needs the `finds_write_verdict` function in verdict-rpc.sql.
 *
 * So this module builds that function's single JSONB argument. The guards here
 * exist to fail early with a readable message; the same checks live in the
 * function and in the schema, because a check that lives only in the caller is
 * not a check. Delete every guard below and the database still refuses the bad
 * write.
 */

import type { Criterion, VerdictScore } from '../types.ts';
import type { CriterionScore } from './types.ts';
import { scoredBy } from './rubric.ts';

/** One verdict, as the `finds_write_verdict` payload carries it. */
export interface VerdictPayload {
  criterion: Criterion;
  score: VerdictScore;
  rationale: string;
  scored_by: string;
  citations: { evidence_id: string; stance: 'supports' | 'contradicts' }[];
}

/** The three arguments `finds_write_verdict` takes, ready for `.rpc()`. */
export interface VerdictRpcArgs {
  p_candidate_id: string;
  p_evidence_run_id: string;
  p_verdicts: VerdictPayload[];
}

/**
 * Split scores into those that can be persisted honestly today and those that
 * cannot, with the reason.
 *
 * Only one thing lands in `blocked`: a verdict whose citations are all
 * `inconclusive`, which finds_verdict_evidence cannot store. Rather than
 * failing the whole candidate -- which would silently cost every one of its
 * other criteria -- the run persists what it can and reports the rest by name.
 * That keeps the cost of the missing enum value VISIBLE instead of hidden in
 * an exception, and it disappears entirely when the CHECK grows a third value.
 */
export function partitionPersistable(scores: readonly CriterionScore[]): {
  persistable: CriterionScore[];
  blocked: { score: CriterionScore; reason: string }[];
} {
  const persistable: CriterionScore[] = [];
  const blocked: { score: CriterionScore; reason: string }[] = [];
  for (const score of scores) {
    if (score.citations.some((citation) => citation.stance === 'inconclusive')) {
      blocked.push({
        score,
        reason:
          `${score.criterion} scores ${score.score} on evidence that settled nothing, and its citations are ` +
          "stance 'inconclusive', which finds_verdict_evidence cannot store. Recording them as 'supports' " +
          'would be false. Pending the proposed third stance value.',
      });
      continue;
    }
    persistable.push(score);
  }
  return { persistable, blocked };
}

/**
 * The arguments for one `finds_write_verdict` call: a candidate's scores and
 * their citations, written as one transaction on the database's side.
 *
 * Throws rather than sending anything dishonest:
 *   - a score with no citations (D7; the function and the trigger agree)
 *   - a score citing one evidence row twice, which would fail on
 *     finds_verdict_evidence's primary key -- merge with mergeCitations()
 *   - an 'inconclusive' stance, which finds_verdict_evidence cannot store.
 *     Writing it as 'supports' would claim backing that does not exist, and
 *     'contradicts' would accuse a real company. Refusing is the only honest
 *     third option until the enum gains a third value.
 */
export function buildVerdictWrite(
  candidateId: string,
  evidenceRunId: string,
  scores: readonly CriterionScore[],
  model?: string,
): VerdictRpcArgs {
  if (scores.length === 0) throw new Error('buildVerdictWrite: nothing to write.');

  const verdicts: VerdictPayload[] = [];

  for (const score of scores) {
    if (score.citations.length === 0) {
      throw new Error(
        `buildVerdictWrite: ${score.criterion} for candidate ${candidateId} cites no evidence. ` +
          'DECISIONS D7 requires every C1-C4 score to reference the evidence that justifies it; ' +
          'rationale prose is supplementary to citations, never a substitute.',
      );
    }
    const blocked = score.citations.filter((citation) => citation.stance === 'inconclusive');
    if (blocked.length > 0) {
      throw new Error(
        `buildVerdictWrite: ${score.criterion} for candidate ${candidateId} cites ${blocked.length} evidence ` +
          "row(s) with stance 'inconclusive', which finds_verdict_evidence cannot store (it allows only " +
          "supports|contradicts). This is the score-1 path: rows we read that settled nothing. Recording " +
          "them as 'supports' would be false. PROPOSED to the coordinator: add 'inconclusive' to the stance " +
          'CHECK. Until then this verdict is deliberately not persisted rather than persisted wrongly.',
      );
    }
    const duplicated = score.citations
      .map((citation) => citation.evidence_id)
      .filter((id, index, all) => all.indexOf(id) !== index);
    if (duplicated.length > 0) {
      throw new Error(
        `buildVerdictWrite: ${score.criterion} for candidate ${candidateId} cites evidence row(s) ` +
          `${[...new Set(duplicated)].join(', ')} more than once. finds_verdict_evidence is keyed on ` +
          '(verdict_id, evidence_id), so the insert would fail on the primary key; merge the citations with ' +
          'mergeCitations() so one row carries one stance.',
      );
    }

    verdicts.push({
      criterion: score.criterion,
      score: score.score,
      rationale: score.rationale,
      scored_by: scoredBy(model),
      citations: score.citations.map((citation) => ({
        evidence_id: citation.evidence_id,
        // Narrowed above: 'inconclusive' has already thrown.
        stance: citation.stance as 'supports' | 'contradicts',
      })),
    });
  }

  return { p_candidate_id: candidateId, p_evidence_run_id: evidenceRunId, p_verdicts: verdicts };
}
