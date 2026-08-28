/**
 * Building the one thing a verdict may be written as.
 *
 * D7's citation check is a DEFERRABLE INITIALLY DEFERRED constraint trigger
 * that fires at COMMIT, and D17 puts every lane behind PostgREST, which gives
 * one transaction per request. Inserting the verdict and then its citations
 * commits the verdict alone, the trigger fires against it uncited, and the
 * transaction aborts -- correctly. No two-call sequence can work.
 *
 * `finds_write_verdict` (W3, migration 20260828210900) is one request and
 * therefore one transaction, so it can satisfy the constraint that two calls
 * cannot. This module builds its arguments, using W3's canonical
 * `WriteVerdictArgs` / `WriteVerdictPayload` rather than a local shape, so a
 * change to the function's signature is a type error here rather than a
 * runtime "function not found".
 *
 * The guards below exist to fail early with a readable message. The same
 * checks live in the function and in the schema, because a check that lives
 * only in the caller is not a check. Delete every guard and the database still
 * refuses the bad write.
 */

import type { CriterionScore } from './types.ts';
import type { WriteVerdictArgs, WriteVerdictPayload } from '../types.ts';

/**
 * The arguments for one `finds_write_verdict` call: a candidate's scores and
 * the citations that justify them, written as one transaction.
 *
 * `p_rubric_version` is required by the function rather than defaulted,
 * because a defaulted version would stamp a rubric onto scores it did not
 * produce. It is taken from the scores themselves and they must agree -- a
 * batch mixing two rubric revisions has no single answer to "which rules
 * produced this", and picking one silently is the failure the column exists to
 * prevent.
 *
 * Throws rather than sending anything dishonest:
 *   - a score with no citations (D7; the function and the trigger agree)
 *   - a score citing one evidence row twice, which would fail on
 *     finds_verdict_evidence's primary key -- merge with mergeCitations()
 *   - scores disagreeing about which rubric produced them
 */
export function buildVerdictWrite(
  candidateId: string,
  evidenceRunId: string,
  scores: readonly CriterionScore[],
  model?: string,
): WriteVerdictArgs {
  if (scores.length === 0) throw new Error('buildVerdictWrite: nothing to write.');

  const versions = [...new Set(scores.map((score) => score.rubric_version))];
  if (versions.length > 1) {
    throw new Error(
      `buildVerdictWrite: candidate ${candidateId} was scored under ${versions.length} rubric revisions ` +
        `(${versions.join(', ')}) in one batch. finds_verdicts.rubric_version records which rules produced ` +
        'a score, and there is no honest single answer here -- re-score the whole generation under one rubric.',
    );
  }

  const verdicts: WriteVerdictPayload[] = [];

  for (const score of scores) {
    if (score.citations.length === 0) {
      throw new Error(
        `buildVerdictWrite: ${score.criterion} for candidate ${candidateId} cites no evidence. ` +
          'DECISIONS D7 requires every C1-C4 score to reference the evidence that justifies it; ' +
          'rationale prose is supplementary to citations, never a substitute.',
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
      // WHO scored it. Which RULES is rubric_version's job, and it has a
      // column of its own now -- putting the version here too would be two
      // sources of truth for one fact.
      scored_by: model ?? 'rubric',
      // Every stance is sent explicitly, including 'inconclusive'. The
      // function COALESCEs an absent one to 'supports', which is right for a
      // caller that has no opinion and wrong for every caller here: a score of
      // 1 cites rows that settled nothing, and letting that default would turn
      // "we found nothing" into "this backs the claim".
      citations: score.citations.map((citation) => ({
        evidence_id: citation.evidence_id,
        stance: citation.stance,
      })),
    });
  }

  return {
    p_candidate_id: candidateId,
    p_evidence_run_id: evidenceRunId,
    p_rubric_version: versions[0],
    p_verdicts: verdicts,
  };
}
