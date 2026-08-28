/**
 * C2 -- "solves a rare problem".
 *
 * THE HONEST LIMIT, STATED UP FRONT: nothing W4 can collect from a product's
 * own website establishes that a problem is RARE. A site is not a survey of
 * its category. So under rubric 1.0 **C2 has no 3** -- "clearly supported by
 * quoted or measured evidence" is not a claim this evidence can carry, and
 * manufacturing one would be exactly the LLM-vibes-dressed-as-a-rubric that
 * D7 forbids. The ceiling is 2, deliberately, and the rationale says so.
 *
 * That costs nothing in ranking: a cap applied to every candidate alike moves
 * no candidate past another. It costs a little in the scale, and it buys the
 * property that a C2 of 3 never appears in a digest claiming evidence we do
 * not have. Reaching 3 would need a signal from outside the product's own site
 * -- a category search, a count of competing launches -- which is a change to
 * W4's collection and a rubric version, not something to fake here.
 *
 * What the site DOES tell us, and what W4 collects in `collectC2()`:
 *
 *   c2_problem_statement    they articulate the problem they exist to solve
 *   c2_named_alternatives   how many existing tools they position against
 *
 * The second is the load-bearing one, and it points DOWNWARD. A crowded
 * category names its incumbents -- "unlike Notion", "instead of Airtable" --
 * because it has to. A site that names three of them has told us, in its own
 * words, that the problem is not rare. That is real contradicting evidence and
 * it is what a 0 cites.
 */

import type { EvidenceRow } from '../types.ts';
import type { CriterionScore, UnscoreableReason } from './types.ts';
import { citeRows, corpusStats, criterionScore, findings } from './rubric.ts';

const PROBLEM_STATEMENT = 'c2_problem_statement';
const PROBLEM_STATEMENT_ABSENT = 'c2_problem_statement_absent';
const NAMED_ALTERNATIVES = 'c2_named_alternatives';

/**
 * How many named incumbents make a category crowded.
 *
 * Three, not two, on purpose. W4 captures the name with
 * `/(?:unlike|instead of|vs\.?)\s+([A-Z]...)/`, which can pick up a
 * capitalised word that is not a product at all, and one or two comparisons is
 * ordinary positioning rather than a crowded field. A false "not rare" costs
 * Nikhil a good find silently, so the threshold errs toward keeping it.
 */
const CROWDED_CATEGORY = 3;

export type C2Result =
  | { kind: 'scored'; score: CriterionScore }
  | { kind: 'unscoreable'; reason: UnscoreableReason; detail: string };

/** Score C2 for one crawl generation. `rows` must be one crawl_run_id. */
export function scoreC2(rows: readonly EvidenceRow[], urlsRefused = 0): C2Result {
  if (rows.length === 0) {
    return { kind: 'unscoreable', reason: 'no_evidence', detail: 'No evidence rows in this crawl generation.' };
  }

  const stated = findings(rows, PROBLEM_STATEMENT);
  const notStated = findings(rows, PROBLEM_STATEMENT_ABSENT);
  const alternatives = findings(rows, NAMED_ALTERNATIVES);

  if (stated.length + notStated.length + alternatives.length === 0) {
    return {
      kind: 'unscoreable',
      reason: 'no_claims_extracted',
      detail:
        `${rows.length} evidence row(s) carry no c2_* observation, present or absent, so the rare-problem ` +
        'pass did not run against this generation.',
    };
  }

  const named = alternatives.reduce(
    (most, finding) => Math.max(most, typeof finding.value === 'number' ? finding.value : 0),
    0,
  );
  const stats = corpusStats(rows, urlsRefused);
  const ceiling =
    ' Rubric 1.0 caps C2 at 2: nothing on a product\'s own site can establish that a problem is rare, and ' +
    'claiming 3 would assert evidence we do not hold.';

  // ---- 0: they told us the category is crowded. ---------------------------
  if (named >= CROWDED_CATEGORY) {
    return {
      kind: 'scored',
      score: criterionScore(
        'C2',
        0,
        `CONTRADICTED: the site positions itself against ${named} existing alternatives by name. A category ` +
          'with that many incumbents is not a rare problem, and this is the site saying so in its own words.',
        citeRows(alternatives, 'contradicts', 'named-alternative observation(s)'),
        stats,
      ),
    };
  }

  // ---- 1: they never say what problem they solve. -------------------------
  if (stated.length === 0) {
    return {
      kind: 'scored',
      score: criterionScore(
        'C2',
        1,
        'NO EVIDENCE: the pages we were permitted to read never state the problem this product exists to ' +
          'solve, so there is nothing to judge rarity against. An absence of evidence, not a mark against ' +
          'the product.' +
          ceiling,
        citeRows(notStated, 'inconclusive', 'missing problem-statement observation(s)'),
        stats,
      ),
    };
  }

  // ---- 2: the ceiling. ----------------------------------------------------
  return {
    kind: 'scored',
    score: criterionScore(
      'C2',
      2,
      `PARTIALLY SUPPORTED: the site states the problem it exists to solve and names ${named} existing ` +
        `alternative(s), below the ${CROWDED_CATEGORY} that would mark a crowded category.` +
        ceiling,
      citeRows(stated, 'supports', 'problem-statement observation(s)'),
      stats,
    ),
  };
}
