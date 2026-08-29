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
 * reproducible -- C1 has no model in it, so re-scoring reads the same immutable
 * rows and must reach the same number (unlike C2 since D38; see rubric.ts), and the numbers below are the whole of the judgment.
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

import type { EvidenceRow, VerdictScore } from '../types.ts';
import type { C1Status, CriterionScore, ScoreCitation, UnscoreableReason } from './types.ts';
import { RUBRIC_VERSION, citeRows, corpusStats, criterionScore, findings } from './rubric.ts';

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

/**
 * A PAGE DOES NOT CORROBORATE ITSELF IN ANOTHER LANGUAGE. Rubric 1.1.
 *
 * Found on the first real crawl. aircoalert.com serves the same landing page at
 * /eu, /es, /gb, /fr, /de and /nl, so every claim on /eu was "echoed on" /es
 * and /gb and scored a clean 3. Those are not two pages agreeing; they are one
 * page in three languages. C1 asks whether what is advertised is TRUE, and a
 * site repeating itself is not evidence of anything -- it is the same
 * assertion, counted twice.
 *
 * The count floor above was written for exactly this risk ("one hit can be
 * shared vocabulary") and does not help, because a locale duplicate produces
 * three or thirty matches just as easily as one.
 *
 * So a corroboration is discounted when the corroborating URL is the claim's
 * own page with a locale segment swapped. Same host, same path once a leading
 * two-letter (or xx-yy) segment is removed. A genuinely different page --
 * /blog/, /pricing, another subdomain -- is untouched, which is the case that
 * carries real corroboration.
 */
function withoutLocale(raw: string): string | null {
  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0 && /^[a-z]{2}(-[a-z]{2})?$/i.test(segments[0])) segments.shift();
    return `${url.host}/${segments.join('/')}`;
  } catch {
    return null;
  }
}

/** True when `corroborating` is `claimPage` under a different locale prefix. */
function isLocaleTwin(claimPage: string, corroborating: unknown): boolean {
  if (typeof corroborating !== 'string' || corroborating === claimPage) return false;
  const a = withoutLocale(claimPage);
  const b = withoutLocale(corroborating);
  return a !== null && a === b;
}

/**
 * The C1 score and its three-way status are 1:1 by construction -- every branch
 * of scoreC1() pairs them this way and nothing else can produce a C1 verdict.
 * This is the exact inverse, for readers (like the selection loader) that have
 * the persisted score and need the distinction back. `c1StatusIsExact` in the
 * tests keeps the two from drifting apart.
 */
export function c1StatusFromScore(score: VerdictScore): C1Status {
  if (score === 0) return 'contradicted';
  if (score === 1) return 'unsubstantiated';
  return 'corroborated';
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

  const contradicted = findings(rows, CONTRADICTED);
  const allCorroborated = findings(rows, CORROBORATED);
  // A claim echoed on a locale variant of the page it was made on is the same
  // page speaking twice. Discounted, and counted, so the rationale can say so.
  const corroborated = allCorroborated.filter((finding) => !isLocaleTwin(finding.row.url, finding.value));
  const localeTwins = allCorroborated.length - corroborated.length;
  const unsubstantiated = findings(rows, UNSUBSTANTIATED);
  const checkable = corroborated.length + unsubstantiated.length + localeTwins;

  // No claims diff in the evidence at all. NOT "we checked and found nothing"
  // -- we never checked, and saying otherwise would invent a finding.
  if (contradicted.length === 0 && checkable === 0 && allCorroborated.length === 0) {
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
    score: { ...criterionScore('C1', score, rationale + twinClause, citations, stats), status },
  });
  const twinClause =
    localeTwins > 0
      ? ` ${localeTwins} further "corroboration(s)" were discounted as the same page under a different ` +
        'locale prefix, which is one assertion counted twice rather than two pages agreeing.'
      : '';

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
      citeRows(contradicted, 'contradicts', 'contradicted claim(s)'),
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
      citeRows(unsubstantiated.length > 0 ? unsubstantiated : allCorroborated, 'inconclusive', 'unsettled claim(s)'),
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
    citeRows(corroborated, 'supports', 'corroborated claim(s)'),
  );
}
