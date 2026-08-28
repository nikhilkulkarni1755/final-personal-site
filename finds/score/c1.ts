/**
 * C1 -- "whatever is being advertised is true".
 *
 * This is the criterion Nikhil put first, and it is the one that can do real
 * damage if it is wrong in either direction. So it is a claims-versus-evidence
 * diff and nothing else (DECISIONS D7), and it keeps a three-way distinction
 * that the 0-3 score alone would destroy.
 *
 * THE DIFF IS NOT COMPUTED HERE. W4 does it, in finds/verify/claims.ts:
 * `extractClaims()` writes down what the landing page asserts, `diffClaims()`
 * hunts each assertion across the other pages the gate permitted, and both
 * halves land in finds_evidence as observations with one of three kinds:
 *
 *     c1_corroborated      another page of theirs says the same thing
 *     c1_contradicted      another page of theirs says the opposite
 *     c1_unsubstantiated   nothing we could read speaks to it either way
 *
 * This file only ROLLS UP those per-claim findings into one auditable verdict.
 * Keeping extraction there and judgment here is what makes the score
 * reproducible: re-scoring reads the same immutable rows and must reach the
 * same number, and the numbers below are the whole of the judgment.
 *
 * THE TWO RULES THAT MATTER, and neither is a threshold:
 *
 *   A CONTRADICTED CLAIM SCORES 0 AND DISQUALIFIES. However well the product
 *   does on C2-C4. Truth is the first criterion; a feed that ships something
 *   that lies is worth less than no feed, and it is Nikhil's domain on the
 *   other end of it.
 *
 *   UNSUBSTANTIATED IS NOT FALSE. It scores 1 -- "no evidence either way" --
 *   and never 0. A two-page site by one person with no docs is not a liar; it
 *   is a site we could not check. R2 measured that the corpus is routinely
 *   thin, so this is the common case, not the edge case, and every rationale
 *   states how much we were allowed to read.
 */

import type { EvidenceRow } from '../types.ts';
import type { C1Status, CriterionScore, ScoreCitation, UnscoreableReason } from './types.ts';
import { RUBRIC_VERSION, corpusClause, corpusStats } from './rubric.ts';

/** The observation kinds W4's diffClaims() emits. The contract between us. */
const CORROBORATED = 'c1_corroborated';
const CONTRADICTED = 'c1_contradicted';
const UNSUBSTANTIATED = 'c1_unsubstantiated';

/**
 * Score 3 ("clearly supported") needs BOTH: enough corroborated claims that
 * the pattern is not a coincidence, and a majority of the checkable ones.
 *
 * The floor exists because W4's matcher corroborates on a two-key-term
 * sentence overlap, which is loose enough that a single hit can be shared
 * vocabulary rather than a real echo. Three independent claims echoed is a
 * pattern; one is not. The ratio exists so that a site making thirty claims
 * and standing up three of them cannot buy a 3 by volume.
 *
 * Both are conventions of rubric 1.0, declared here rather than buried, and
 * changing either is a version bump.
 */
const CLEAR_SUPPORT_MIN_CLAIMS = 3;
const CLEAR_SUPPORT_MIN_RATIO = 0.6;

interface Finding {
  row: EvidenceRow;
  detail: string;
}

function collect(rows: readonly EvidenceRow[], kind: string): Finding[] {
  const found: Finding[] = [];
  for (const row of rows) {
    for (const observation of row.observations) {
      if (observation.kind === kind) found.push({ row, detail: observation.detail ?? '' });
    }
  }
  return found;
}

/** One citation per distinct evidence row, so a 40-claim diff is readable. */
function cite(findings: readonly Finding[], stance: ScoreCitation['stance'], label: string): ScoreCitation[] {
  const byRow = new Map<string, { row: EvidenceRow; count: number }>();
  for (const finding of findings) {
    const seen = byRow.get(finding.row.id);
    if (seen) seen.count += 1;
    else byRow.set(finding.row.id, { row: finding.row, count: 1 });
  }
  return [...byRow.values()].map(({ row, count }) => ({
    evidence_id: row.id,
    stance,
    note: `${count} ${label} claim(s) recorded against ${row.url} (${row.page_role})`,
  }));
}

export type C1Result =
  | { kind: 'scored'; score: CriterionScore }
  | { kind: 'unscoreable'; reason: UnscoreableReason; detail: string };

/**
 * Roll one crawl generation's claim diff into a C1 verdict.
 *
 * `rows` must already be narrowed to a single crawl_run_id (see
 * rubric.ts `generation()`) -- mixing generations would make the verdict's
 * evidence_run_id false. `urlsRefused` comes from finds_crawl_verdicts and
 * only ever enters the rationale; it never moves the score, because how much
 * a site let us read is not a fact about whether the site is honest.
 */
export function scoreC1(rows: readonly EvidenceRow[], urlsRefused = 0): C1Result {
  if (rows.length === 0) {
    return { kind: 'unscoreable', reason: 'no_evidence', detail: 'No evidence rows in this crawl generation.' };
  }

  const contradicted = collect(rows, CONTRADICTED);
  const corroborated = collect(rows, CORROBORATED);
  const unsubstantiated = collect(rows, UNSUBSTANTIATED);
  const checkable = corroborated.length + unsubstantiated.length;

  // No claims diff in the evidence at all. NOT "we checked and found nothing"
  // -- we never checked, and saying otherwise would invent a finding.
  if (contradicted.length === 0 && checkable === 0) {
    return {
      kind: 'unscoreable',
      reason: 'no_claims_extracted',
      detail:
        `${rows.length} evidence row(s) carry no c1_* observation, so there is no left-hand side to diff. ` +
        'Either the landing page asserted nothing checkable or the claims pass did not run.',
    };
  }

  const stats = corpusStats(rows, urlsRefused);
  const build = (
    score: CriterionScore['score'],
    status: C1Status,
    rationale: string,
    citations: ScoreCitation[],
  ): C1Result => ({
    kind: 'scored',
    score: { criterion: 'C1', score, status, rationale: `${rationale} ${corpusClause(stats)}`, citations, rubric_version: RUBRIC_VERSION },
  });

  // ---- CONTRADICTED. Disqualifying, and it cites what disproves the claim. --
  if (contradicted.length > 0) {
    const shown = contradicted.slice(0, 3).map((f) => f.detail).filter((d) => d !== '');
    return build(
      0,
      'contradicted',
      `CONTRADICTED: ${contradicted.length} of ${contradicted.length + checkable} checkable claim(s) are ` +
        "contradicted by the site's own pages. Under rubric " +
        `${RUBRIC_VERSION} any contradicted claim scores 0 and disqualifies the candidate regardless of C2-C4.` +
        (shown.length > 0 ? ` ${shown.join(' ')}` : ''),
      cite(contradicted, 'contradicts', 'contradicted'),
    );
  }

  // ---- UNSUBSTANTIATED. Not false. Cites the rows that settled nothing. -----
  if (corroborated.length === 0) {
    return build(
      1,
      'unsubstantiated',
      `UNSUBSTANTIATED: none of the ${checkable} checkable claim(s) found corroborating OR contradicting ` +
        'evidence among the pages we were permitted to read. This is an absence of evidence, not evidence ' +
        'against the product, and it scores 1 ("no evidence either way") rather than 0.',
      cite(unsubstantiated, 'inconclusive', 'unsubstantiated'),
    );
  }

  // ---- CORROBORATED, in two strengths. -------------------------------------
  const ratio = corroborated.length / checkable;
  const clear = corroborated.length >= CLEAR_SUPPORT_MIN_CLAIMS && ratio >= CLEAR_SUPPORT_MIN_RATIO;
  return build(
    clear ? 3 : 2,
    'corroborated',
    `CORROBORATED${clear ? '' : ' (partial)'}: ${corroborated.length} of ${checkable} checkable claim(s) are ` +
      `echoed on another page of the site (${(ratio * 100).toFixed(0)}%), ${unsubstantiated.length} found ` +
      `nothing either way, and none are contradicted. Rubric ${RUBRIC_VERSION} scores 3 only at ` +
      `>=${CLEAR_SUPPORT_MIN_CLAIMS} corroborated and >=${(CLEAR_SUPPORT_MIN_RATIO * 100).toFixed(0)}%.`,
    cite(corroborated, 'supports', 'corroborated'),
  );
}
