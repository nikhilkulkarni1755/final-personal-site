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
 *     3  no barrier at all, AND an explicit way in
 *     2  no barrier at all              <- "it is just a website that works"
 *     2  one barrier, but an explicit way in
 *     1  one barrier and nothing explicit
 *
 * RUBRIC 1.2 CORRECTS A POLARITY ERROR, and it is worth stating what was wrong
 * because the mistake is easy to make again. Until 1.1 this criterion required
 * open-access SIGNALS -- a free tier, "no credit card", a readable pricing page
 * -- before it would score above 1. Those are markers of being a COMPANY, not
 * of being usable. A one-person stock tracker and a GitHub project scored 1
 * while being trivially usable, because neither has a pricing page.
 *
 * "Usable by any person" is the DEFAULT. Barriers subtract from it. A site with
 * nothing in the way is usable, whether or not anyone published a price list.
 *
 * So a readable pricing page is no longer a way in, and its ABSENCE is no
 * longer a penalty: for a product with nothing to sell there is nothing to
 * price, and reading that as missing evidence is what inverted the criterion.
 * It is recorded and scores nothing.
 *
 * And absence of a BARRIER is positive evidence here, unlike absence of
 * corroboration in C1. We went looking for a waitlist, a terminal requirement,
 * a platform restriction and a demand for your own API key, and found none.
 * That is a finding about the product, so those observations are cited as
 * SUPPORTING rather than as inconclusive.
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

/** Ways in. An explicit, published invitation to start without paying. */
const FREE_TIER = 'c3_free_tier';
const NO_CARD = 'c3_no_card_required';
/** Recorded, never scored. Neither its presence nor its absence is evidence. */
const PRICING_PAGE = 'c3_pricing_page';

/** Ways barred. */
const WAITLIST = 'c3_waitlist';
const BARRIERS = ['c3_terminal_required', 'c3_platform_restriction', 'c3_own_key_required'] as const;

/**
 * We looked for a wall and there was none. Positive evidence of accessibility,
 * and what a score of 2 cites when a product simply has nothing in the way.
 */
const BARRIERS_ABSENT = [
  'c3_waitlist_absent',
  'c3_terminal_required_absent',
  'c3_platform_restriction_absent',
  'c3_own_key_required_absent',
] as const;

/** Absence of a way IN is genuinely inconclusive -- it settles nothing. */
const WAYS_IN_ABSENT = ['c3_free_tier_absent', 'c3_no_card_required_absent'] as const;

/** Two independent barriers is a product for a narrow audience. */
const TOO_MANY_BARRIERS = 2;

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
  // Ways IN are explicit invitations only. The pricing page is read for
  // neither side now -- see the header.
  const open = findings(rows, FREE_TIER, NO_CARD);
  const barriersAbsent = findings(rows, ...BARRIERS_ABSENT);
  const waysInAbsent = findings(rows, ...WAYS_IN_ABSENT);
  const pricing = findings(rows, PRICING_PAGE);

  if (
    waitlist.length + barriers.length + open.length + barriersAbsent.length +
      waysInAbsent.length + pricing.length ===
    0
  ) {
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
  // "We looked for a wall and found none" is the evidence for an unobstructed
  // product. When W4 recorded no such absence, fall back to whatever c3 rows
  // exist so a score still cites something real rather than failing to write.
  const clearPath = barriersAbsent.length > 0 ? barriersAbsent : [...waysInAbsent, ...pricing];

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

  // ---- 3: nothing in the way, and an explicit invitation to start. --------
  if (barriers.length === 0 && open.length > 0) {
    return done(
      3,
      `CLEARLY SUPPORTED: not one barrier found across the pages we read, and ${open.length} explicit ` +
        'open-access signal(s) -- a free tier, or no card required. Nothing stands between a visitor and ' +
        'the product, and the site says so itself.',
      mergeCitations(
        citeRows(open, 'supports', 'open-access observation(s)'),
        citeRows(barriersAbsent, 'supports', 'barrier(s) looked for and not found'),
      ),
    );
  }

  // ---- 2: nothing in the way. That is the criterion, met. -----------------
  if (barriers.length === 0) {
    return done(
      2,
      'SUPPORTED: no waitlist, no terminal requirement, no platform restriction and no demand for your own ' +
        'API key. Nothing published invites you in either, but "usable by any person" is the default and ' +
        'nothing here subtracts from it. A product with no pricing page most often has nothing to sell.',
      citeRows(clearPath, 'supports', 'barrier(s) looked for and not found'),
    );
  }

  // ---- 2: one barrier, but a real way in past it. -------------------------
  if (open.length > 0) {
    return done(
      2,
      `SUPPORTED: ${open.length} open-access signal(s) against ${barriers.length} barrier(s). One barrier is ` +
        'not disqualifying -- a CLI-first tool with a real free tier is still a find -- and the barrier is ' +
        'cited here as contradicting so he can judge it himself.',
      mergeCitations(
        citeRows(open, 'supports', 'open-access observation(s)'),
        citeRows(barriers, 'contradicts', 'access-barrier observation(s)'),
      ),
    );
  }

  // ---- 1: one barrier, and nothing inviting anyone past it. --------------
  return done(
    1,
    `BARELY EVIDENCED: ${barriers.length} barrier stands between a general visitor and this product, and ` +
      'nothing published offers a way past it. Not disqualifying on its own, but not "usable by any person" ' +
      'either, and there is nothing on the other side of the scale.',
    mergeCitations(
      citeRows(barriers, 'contradicts', 'access-barrier observation(s)'),
      citeRows(waysInAbsent, 'inconclusive', 'absent open-access observation(s)'),
    ),
  );
}
