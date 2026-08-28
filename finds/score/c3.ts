/**
 * C3 -- "is usable by any person".
 *
 * ANY person. Not any developer. That reading is the whole criterion, and it
 * is what makes the barriers the discriminating evidence rather than the
 * features: `npm install` is a fact about who can use the thing, and so is
 * "bring your own OpenAI key", and both are recorded by W4 as observations
 * about the page rather than opinions about the audience
 * (finds/verify/signals.ts `collectC3()`).
 *
 *     0  a waitlist or invite gate, OR two independent barriers
 *     3  two or more open-access signals AND no barrier at all
 *     2  some open-access signal, at most one barrier
 *     1  we found neither, so we could not tell
 *
 * A WAITLIST IS A 0, not a low 1. "Join the waitlist" is not weak evidence of
 * usability -- it is direct evidence that no person can use it today, which is
 * the criterion's plain negation. W4's pattern is deliberately narrow here
 * (its own comment records that a bare "request access" matched a privacy page
 * offering your own data on the first field run), so a hit is trustworthy.
 *
 * ONE BARRIER IS NOT DISQUALIFYING. A CLI-first tool with a generous free tier
 * is a real find and Nikhil can decide; two independent barriers -- a terminal
 * AND your own API key, say -- is a product for a narrow audience, and the
 * evidence says so.
 */

import type { EvidenceRow } from '../types.ts';
import type { CriterionScore, UnscoreableReason } from './types.ts';
import { citeRows, corpusStats, criterionScore, findings, mergeCitations } from './rubric.ts';

/** Ways in. */
const FREE_TIER = 'c3_free_tier';
const NO_CARD = 'c3_no_card_required';
const PRICING_PAGE = 'c3_pricing_page';

/** Ways barred. */
const WAITLIST = 'c3_waitlist';
const BARRIERS = ['c3_terminal_required', 'c3_platform_restriction', 'c3_own_key_required'] as const;

const ABSENT = [
  'c3_free_tier_absent',
  'c3_no_card_required_absent',
  'c3_waitlist_absent',
  'c3_terminal_required_absent',
  'c3_platform_restriction_absent',
  'c3_own_key_required_absent',
] as const;

/** Two independent barriers is a product for a narrow audience. */
const TOO_MANY_BARRIERS = 2;
/** Two ways in, and nothing in the way, is what "any person" looks like. */
const CLEARLY_OPEN = 2;

export type C3Result =
  | { kind: 'scored'; score: CriterionScore }
  | { kind: 'unscoreable'; reason: UnscoreableReason; detail: string };

/** Score C3 for one crawl generation. `rows` must be one crawl_run_id. */
export function scoreC3(rows: readonly EvidenceRow[], urlsRefused = 0): C3Result {
  if (rows.length === 0) {
    return { kind: 'unscoreable', reason: 'no_evidence', detail: 'No evidence rows in this crawl generation.' };
  }

  const waitlist = findings(rows, WAITLIST);
  const barriers = findings(rows, ...BARRIERS);
  // W4 emits c3_pricing_page either way, carrying the URL or null, so a
  // readable pricing page counts as a way in and an unreadable one does not.
  const open = [
    ...findings(rows, FREE_TIER, NO_CARD),
    ...findings(rows, PRICING_PAGE).filter((finding) => finding.value !== null),
  ];
  const absent = findings(rows, ...ABSENT);

  if (waitlist.length + barriers.length + open.length + absent.length + findings(rows, PRICING_PAGE).length === 0) {
    return {
      kind: 'unscoreable',
      reason: 'no_claims_extracted',
      detail:
        `${rows.length} evidence row(s) carry no c3_* observation, present or absent, so the usability pass ` +
        'did not run against this generation.',
    };
  }

  const stats = corpusStats(rows, urlsRefused);
  const done = (score: 0 | 1 | 2 | 3, rationale: string, citations: CriterionScore['citations']): C3Result => ({
    kind: 'scored',
    score: criterionScore('C3', score, rationale, citations, stats),
  });

  // ---- 0: nobody can use it, or almost nobody. ----------------------------
  if (waitlist.length > 0) {
    return done(
      0,
      'CONTRADICTED: access is gated behind a waitlist or an invite. This is not weak evidence of usability, ' +
        'it is direct evidence that no person can use it today, which is the plain negation of the criterion.',
      citeRows(waitlist, 'contradicts', 'waitlist/invite gate observation(s)'),
    );
  }
  if (barriers.length >= TOO_MANY_BARRIERS) {
    return done(
      0,
      `CONTRADICTED: ${barriers.length} independent barriers stand between a general visitor and this ` +
        'product (a terminal, a platform restriction, or supplying your own third-party API key). One of ' +
        'those is a tool with a narrower audience; two is not "usable by any person".',
      citeRows(barriers, 'contradicts', 'access-barrier observation(s)'),
    );
  }

  // ---- 3: open, with nothing in the way. ----------------------------------
  if (open.length >= CLEARLY_OPEN && barriers.length === 0) {
    return done(
      3,
      `CLEARLY SUPPORTED: ${open.length} independent open-access signals (a free tier, no card required, a ` +
        'readable pricing page) and not one barrier found across the pages we read.',
      citeRows(open, 'supports', 'open-access observation(s)'),
    );
  }

  // ---- 2: a way in, and at most one thing in the way. ---------------------
  if (open.length > 0) {
    return done(
      2,
      `PARTIALLY SUPPORTED: ${open.length} open-access signal(s) against ${barriers.length} barrier(s). ` +
        'One barrier is not disqualifying -- a CLI-first tool with a real free tier is still a find, and ' +
        'the barrier is named here so he can judge it himself.',
      mergeCitations(
        citeRows(open, 'supports', 'open-access observation(s)'),
        citeRows(barriers, 'contradicts', 'access-barrier observation(s)'),
      ),
    );
  }

  // ---- 1: we could not tell. ----------------------------------------------
  return done(
    1,
    `NO EVIDENCE: no free tier, no "no credit card", no readable pricing page, and ${barriers.length} ` +
      'barrier(s) found. Nothing we were permitted to read says what it costs or who can use it, so this ' +
      'is an absence of evidence rather than a mark against the product.',
    mergeCitations(
      citeRows(absent, 'inconclusive', 'absent access-signal observation(s)'),
      citeRows(barriers, 'contradicts', 'access-barrier observation(s)'),
    ),
  );
}
