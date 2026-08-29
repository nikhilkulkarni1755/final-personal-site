/**
 * C2 -- "solves a rare problem", under DECISIONS D37.
 *
 * D37 defines rarity as NOVELTY IN KIND, not category crowdedness: mixing two
 * common apps into one, a new paradigm of thinking, or solving a new type of
 * task. Every earlier version of this criterion measured how crowded a category
 * was, which is a different question that happened to share an answer on one
 * example. Narrow is not novel -- a stock tracker for one appliance model is
 * still a stock tracker.
 *
 * *** DETERMINISM CARVE-OUT -- READ THIS BEFORE REPEATING THE GUARANTEE ***
 *
 * Every other criterion is a pure function of fetched bytes: same evidence in,
 * same score out, proven 36/36 against production. C2 IS NOT, and any statement
 * of that guarantee must now say "C1, C3 and C4" rather than "every verdict".
 *
 * What is still true, and worth keeping precise:
 *   - `scoreC2` itself is pure. Given the same judgement it returns the same
 *     score, rationale and citation, forever.
 *   - The JUDGEMENT is not reproducible in principle. It comes from a model
 *     (novelty.ts), so nothing guarantees two runs agree.
 *   - MEASURED, four passes over nine real candidates: the SCORE was stable
 *     every time -- 9/9 form and 9/9 C2 score, under both the old question and
 *     the current one. What moved was the JUSTIFICATION: the cited claim was
 *     7/9 stable under the old question and 9/9 under the current one, and the
 *     wording and ordering of the named products still varies run to run.
 *   - So the honest statement is not "the score may move" but "the score has
 *     been stable and the evidence recorded for it has not been". That matters
 *     for D7 specifically: two runs can put the same number on record against
 *     differently-worded justification. Do not read this as a guarantee -- it
 *     is a measurement on nine candidates, not a property of the design.
 *   - `finds_verdicts.scored_by` carries the model id for exactly this reason:
 *     it is the only criterion where "who scored it" is not "the rubric".
 *
 * This is the cost D38 accepted knowingly. It is bounded to one criterion by
 * keeping the model call out of this file entirely.
 */

import type { EvidenceRow } from '../types.ts';
import type { CriterionScore, UnscoreableReason } from './types.ts';
import type { NoveltyJudgement } from './novelty.ts';
import { RUBRIC_VERSION, citeRows, corpusStats, criterionScore, findings } from './rubric.ts';

const PROBLEM_STATEMENT = 'c2_problem_statement';
const PROBLEM_STATEMENT_ABSENT = 'c2_problem_statement_absent';

export type C2Result =
  | { kind: 'scored'; score: CriterionScore }
  | { kind: 'unscoreable'; reason: UnscoreableReason; detail: string };

/**
 * Score C2 from a novelty judgement.
 *
 * `judgement` is null when the model could not be asked, declined, or cited a
 * claim we never supplied. That is scored 1 -- "no evidence either way" -- and
 * NEVER 0. An unverifiable judgement must not become an accusation, and a
 * criterion-level unscoreable would be worse still: it makes scoreCandidate
 * return three scores of four, which selection rejects as `incomplete_scores`,
 * dropping the candidate silently.
 */
export function scoreC2(
  rows: readonly EvidenceRow[],
  judgement: NoveltyJudgement | null,
  urlsRefused = 0,
): C2Result {
  if (rows.length === 0) {
    return { kind: 'unscoreable', reason: 'no_evidence', detail: 'No evidence rows in this crawl generation.' };
  }

  const stated = findings(rows, PROBLEM_STATEMENT);
  const notStated = findings(rows, PROBLEM_STATEMENT_ABSENT);
  if (judgement === null && stated.length + notStated.length === 0) {
    return {
      kind: 'unscoreable',
      reason: 'no_claims_extracted',
      detail:
        `${rows.length} evidence row(s) carry no c2_* observation and no novelty judgement was obtained, ` +
        'so there is nothing to score this criterion from.',
    };
  }

  const stats = corpusStats(rows, urlsRefused);
  const cited = judgement === null ? [] : rows.filter((row) => row.id === judgement.evidence_id);
  const quote = (j: NoveltyJudgement) => ` It rests on the product's own claim: "${j.cited_claim}". ${j.reason}`;
  const by = (j: NoveltyJudgement) => ` Judged by ${j.model} under rubric ${RUBRIC_VERSION}.`;

  // ---- no usable judgement: 1, never 0. ------------------------------------
  if (judgement === null || judgement.form === 'unsure') {
    return {
      kind: 'scored',
      score: criterionScore(
        'C2',
        1,
        'NO EVIDENCE: novelty could not be established either way. Either no judgement was obtained, or the ' +
          'judgement could not name prior art and could not identify a new kind of task. An absence of ' +
          'evidence, not a mark against the product.',
        citeRows(
          cited.length > 0 ? cited.map((row) => ({ row, detail: '', value: null })) : stated.concat(notStated),
          'inconclusive',
          'unsettled novelty observation(s)',
        ),
        stats,
      ),
    };
  }

  const finding = { row: cited[0]!, detail: judgement.reason, value: judgement.prior_art };

  // ---- 0: prior art exists, and it is named. -------------------------------
  // Reachable again, unlike the crowdedness signal it replaces, because this
  // rests on positive checkable evidence rather than on a pattern's silence.
  // A reader can look up the named product and disagree in one glance.
  if (judgement.form === 'established') {
    return {
      kind: 'scored',
      score: criterionScore(
        'C2',
        0,
        `CONTRADICTED: this is an established task, already done by ${judgement.prior_art ?? 'existing products'}. ` +
          'D37 counts a problem as rare only when it fuses two common applications, introduces a new paradigm, ' +
          'or solves a new type of task; doing an old task well is none of those, however narrow the niche.' +
          quote(judgement) +
          by(judgement),
        citeRows([finding], 'contradicts', 'claim showing an established task'),
        stats,
      ),
    };
  }

  // ---- 2: D37 form (1), a fusion no single product covers. -----------------
  // Nikhil's call: a fusion of known things IS novel. The judge reaches this
  // only when it could not name one product doing all of it AND could name the
  // separate things being combined -- both halves required, because "these two
  // features together are new" is assertable about almost anything.
  if (judgement.form === 'fusion') {
    return {
      kind: 'scored',
      score: criterionScore(
        'C2',
        2,
        `PARTIALLY SUPPORTED: D37 form (1) -- this combines ${(judgement.fused_from ?? []).join(' + ')}, ` +
          'and no single existing product was nameable that does all of it. Real novelty, assembled from ' +
          'parts that already existed, which is why it scores below a new paradigm or a new type of task.' +
          quote(judgement) +
          by(judgement),
        citeRows([finding], 'supports', 'claim showing a fusion no single product covers'),
        stats,
      ),
    };
  }

  // ---- 3: D37 forms (2) and (3). -------------------------------------------
  return {
    kind: 'scored',
    score: criterionScore(
      'C2',
      3,
      `CLEARLY SUPPORTED: D37 form ${judgement.form === 'new_paradigm' ? '(2), a new paradigm of thinking' : '(3), a new type of task'}, ` +
        'and no existing product could be named that already does it.' +
        quote(judgement) +
        by(judgement),
      citeRows([finding], 'supports', 'claim showing novelty in kind'),
      stats,
    ),
  };
}
