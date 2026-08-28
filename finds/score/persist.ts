/**
 * Writing a verdict, which under DECISIONS D7 means writing its citations in
 * the same breath.
 *
 * W3 made that structural rather than conventional: a DEFERRABLE INITIALLY
 * DEFERRED constraint trigger aborts the transaction at COMMIT if a verdict
 * has no citation, the same check fires when the last citation is deleted, and
 * composite foreign keys make citing another product's evidence an FK
 * violation. This file is written WITH that, not against it -- the guards below
 * exist to fail early with a readable message, not to replace the database's
 * check. Delete every guard and the schema still refuses the bad write.
 *
 * WHY A STATEMENT PLAN RATHER THAN A CLIENT. `pg` is not on main yet (W2's PR
 * carries it), and the interesting part of this code is the SQL and its
 * ordering, not the driver. So this builds the exact ordered statements the
 * write consists of, which prove-d7.sh then executes against a real Postgres.
 * When a driver lands, running the plan is a five-line loop.
 */

import type { Criterion } from '../types.ts';
import type { CriterionScore } from './types.ts';
import { scoredBy } from './rubric.ts';

export interface SqlStatement {
  text: string;
  values: unknown[];
}

/**
 * Stale citations first, in their own statement.
 *
 * A re-score must not leave last generation's citations attached to this
 * generation's number. It is safe to strip them before the replacements exist
 * because the trigger is deferred: within the transaction a verdict may sit
 * momentarily uncited, and only the COMMIT has to be honest.
 */
const CLEAR_CITATIONS = `DELETE FROM finds_verdict_evidence
 WHERE verdict_id IN (
       SELECT id FROM finds_verdicts
        WHERE candidate_id = $1 AND evidence_run_id = $2 AND criterion = $3)`;

/**
 * Verdict and citations in ONE statement, so the citations cannot be lost to a
 * failure between two of them. The CTE hands the (possibly newly generated)
 * verdict id straight to the insert, and carries candidate_id with it so the
 * composite FK is satisfied from the verdict's own row rather than from
 * anything the caller passed -- citing another candidate's evidence stays
 * impossible even if the caller is confused about which candidate it is on.
 */
const WRITE_VERDICT = `WITH v AS (
  INSERT INTO finds_verdicts (candidate_id, evidence_run_id, criterion, score, rationale, scored_by)
       VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (candidate_id, evidence_run_id, criterion)
  DO UPDATE SET score = EXCLUDED.score,
                rationale = EXCLUDED.rationale,
                scored_by = EXCLUDED.scored_by
    RETURNING id, candidate_id
)
INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id, stance)
SELECT v.id, c.evidence_id, v.candidate_id, c.stance
  FROM v, unnest($7::uuid[], $8::text[]) AS c(evidence_id, stance)`;

/**
 * The ordered statements that persist one candidate's scores for one crawl
 * generation. Run them, in order, in a single transaction -- BEGIN and COMMIT
 * are included because the deferred trigger only means anything if the COMMIT
 * is the same COMMIT.
 *
 * Throws rather than writing anything dishonest:
 *   - a score with no citations (D7, and the DB would abort at COMMIT anyway)
 *   - an 'inconclusive' stance, which finds_verdict_evidence cannot yet store.
 *     Writing it as 'supports' would say a row backs a claim it does not back,
 *     and writing it as 'contradicts' would accuse a real company. Refusing is
 *     the only honest third option until the enum gains a third value.
 */
export function buildVerdictWrite(
  candidateId: string,
  evidenceRunId: string,
  scores: readonly CriterionScore[],
  model?: string,
): SqlStatement[] {
  if (scores.length === 0) throw new Error('buildVerdictWrite: nothing to write.');

  const statements: SqlStatement[] = [{ text: 'BEGIN', values: [] }];

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

    const criterion: Criterion = score.criterion;
    const key = [candidateId, evidenceRunId, criterion];
    statements.push({ text: CLEAR_CITATIONS, values: key });
    statements.push({
      text: WRITE_VERDICT,
      values: [
        ...key,
        score.score,
        score.rationale,
        scoredBy(model),
        score.citations.map((citation) => citation.evidence_id),
        score.citations.map((citation) => citation.stance),
      ],
    });
  }

  statements.push({ text: 'COMMIT', values: [] });
  return statements;
}
