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
import { RUBRIC_VERSION, citeRows, corpusStats, criterionScore, findings } from './rubric.ts';

const PROBLEM_STATEMENT = 'c2_problem_statement';
const PROBLEM_STATEMENT_ABSENT = 'c2_problem_statement_absent';
const NAMED_ALTERNATIVES = 'c2_named_alternatives';

/**
 * NAMED ALTERNATIVES NO LONGER SCORE. Rubric 1.1, and this is a retraction.
 *
 * Rubric 1.0 scored 0 -- disqualifying -- at three or more named alternatives,
 * on the reasoning that a crowded category names its incumbents. The threshold
 * was set at three rather than two precisely because W4's capture regex can
 * pick up a capitalised word that is not a product. Measured against the first
 * ten real crawls, three was nowhere near enough:
 *
 *   gmplus.io                 "Google, Bulk, Email, International, Phone,
 *                              CSV, JSON, Coordinates"   -> 8, all noise
 *   motiongraphicseditor.ai   "After, Now, Industry, After."
 *                              -> 4, and "After" is half of "After Effects"
 *   teamretro.com             "EasyRetro, Miro, Parabol, Retrium, ..."
 *                              -> 23, genuine -- and it lists ITSELF too
 *
 * Two of the three disqualifications were pure artifacts of prose like "export
 * to CSV, JSON". No threshold separates 8 noise tokens from 23 real ones, so
 * the count is not the signal and never was.
 *
 * The cost is asymmetric, which settles it. A false disqualification removes a
 * good find SILENTLY -- Nikhil never learns the product existed. A missed
 * disqualification just means he sees a crowded-category product and judges it
 * himself, with the names in front of him. So the alternatives are REPORTED in
 * the rationale and score nothing.
 *
 * This is also the symmetric half of the position C2 already took: if nothing
 * on a product's own site can establish that a problem is rare, then nothing on
 * it establishes the opposite either. C2 is now {1, 2} -- an honest range
 * rather than a wide one.
 */

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
    ` Rubric ${RUBRIC_VERSION} caps C2 at 2 and gives it no 0: nothing on a product's own site can ` +
    'establish that a problem is rare, and nothing on it establishes the opposite either.';
  const context =
    named > 0
      ? ` The site names ${named} existing alternative(s) it positions against. Reported, not scored: ` +
        'measured against real sites that capture yields prose nouns ("CSV", "After") as often as products, ' +
        'so it is context for a human rather than evidence for a number.'
      : ' The site names no existing alternative it positions against.';

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
          context +
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
      'PARTIALLY SUPPORTED: the site states the problem it exists to solve.' + context + ceiling,
      citeRows(stated, 'supports', 'problem-statement observation(s)'),
      stats,
    ),
  };
}
