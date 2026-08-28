/**
 * C2 (solves a rare problem) and C3 (usable by any person).
 *
 * They share a file because they share the thing worth testing: both are
 * criteria where the honest answer is often "we cannot tell from a product's
 * own website", and both have to say that rather than produce a number.
 *
 * Evidence is constructed inline and thrown away (D6).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceObservation, EvidenceRow } from '../types.ts';
import type { CriterionScore } from './types.ts';
import { scoreC2 } from './c2.ts';
import { scoreC3 } from './c3.ts';

let seq = 0;
function row(observations: EvidenceObservation[], url = 'https://x/'): EvidenceRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    candidate_id: '00000000-0000-4000-8000-00000000cafe',
    crawl_verdict_id: '00000000-0000-4000-8000-0000000000a1',
    crawl_run_id: '00000000-0000-4000-8000-00000000c230',
    url,
    page_role: 'homepage',
    http_status: 200,
    content_type: 'text/html',
    content_sha256: null,
    fetched_at: '2026-08-28T21:00:00Z',
    claims: [],
    quotes: [],
    observations,
    created_at: '2026-08-28T21:00:00Z',
  };
}

function scored(result: { kind: string; score?: CriterionScore }): CriterionScore {
  assert.equal(result.kind, 'scored', `expected a score, got ${JSON.stringify(result)}`);
  return result.score!;
}

/* ========================================================================== */
/* C2                                                                          */
/* ========================================================================== */

const problemStated: EvidenceObservation = { kind: 'c2_problem_statement', detail: 'why we built this', value: 'https://x/' };
const problemNotStated: EvidenceObservation = { kind: 'c2_problem_statement_absent', detail: 'no such statement', value: false };
const alternatives = (n: number): EvidenceObservation => ({ kind: 'c2_named_alternatives', detail: `names ${n}`, value: n });

test('C2 has no 3 under rubric 1.0, and the rationale says why', () => {
  const score = scored(scoreC2([row([problemStated, alternatives(0)])]));
  assert.equal(score.score, 2);
  assert.match(score.rationale, /caps C2 at 2/);
  assert.match(score.rationale, /nothing on a product's own site can establish that a problem is rare/);
});

test('a site naming three incumbents has told us the category is crowded', () => {
  const score = scored(scoreC2([row([problemStated, alternatives(3)])]));
  assert.equal(score.score, 0);
  assert.deepEqual(score.citations.map((c) => c.stance), ['contradicts']);
  assert.match(score.rationale, /in its own words/);
});

test('two named alternatives is ordinary positioning, not a crowded category', () => {
  assert.equal(scored(scoreC2([row([problemStated, alternatives(2)])])).score, 2);
});

test('a site that never states its problem scores 1, and cites the absence', () => {
  const score = scored(scoreC2([row([problemNotStated, alternatives(0)])]));
  assert.equal(score.score, 1);
  assert.deepEqual(score.citations.map((c) => c.stance), ['inconclusive']);
  assert.match(score.rationale, /not a mark against the product/);
});

test('C2 with no c2_* observation at all is unscoreable', () => {
  const result = scoreC2([row([{ kind: 'c1_corroborated', detail: 'a' }])]);
  assert.equal(result.kind, 'unscoreable');
  assert.equal(result.kind === 'unscoreable' && result.reason, 'no_claims_extracted');
});

/* ========================================================================== */
/* C3                                                                          */
/* ========================================================================== */

const freeTier: EvidenceObservation = { kind: 'c3_free_tier', detail: 'free tier advertised', value: 'https://x/' };
const noCard: EvidenceObservation = { kind: 'c3_no_card_required', detail: 'no credit card', value: 'https://x/' };
const pricing: EvidenceObservation = { kind: 'c3_pricing_page', detail: 'readable', value: 'https://x/pricing' };
const noPricing: EvidenceObservation = { kind: 'c3_pricing_page', detail: 'not permitted', value: null };
const waitlist: EvidenceObservation = { kind: 'c3_waitlist', detail: 'join the waitlist', value: 'https://x/' };
const terminal: EvidenceObservation = { kind: 'c3_terminal_required', detail: 'npm install', value: 'https://x/' };
const ownKey: EvidenceObservation = { kind: 'c3_own_key_required', detail: 'bring your own key', value: 'https://x/' };
const c3Absent: EvidenceObservation[] = [
  { kind: 'c3_free_tier_absent', detail: 'none found', value: false },
  { kind: 'c3_no_card_required_absent', detail: 'none found', value: false },
  { kind: 'c3_waitlist_absent', detail: 'none found', value: false },
  { kind: 'c3_terminal_required_absent', detail: 'none found', value: false },
];

test('a waitlist is a 0: nobody can use it today', () => {
  const score = scored(scoreC3([row([waitlist, freeTier, noCard, pricing])]));
  assert.equal(score.score, 0);
  assert.deepEqual(score.citations.map((c) => c.stance), ['contradicts']);
  assert.match(score.rationale, /plain negation of the criterion/);
});

test('two independent barriers is not "usable by any person"', () => {
  const score = scored(scoreC3([row([terminal, ownKey, freeTier])]));
  assert.equal(score.score, 0);
  assert.match(score.rationale, /2 independent barriers/);
});

test('one barrier is not disqualifying, and is named so he can judge it', () => {
  const score = scored(scoreC3([row([freeTier, noCard]), row([terminal], 'https://x/docs')]));
  assert.equal(score.score, 2);
  assert.match(score.rationale, /still a find/);
  assert.deepEqual(
    new Set(score.citations.map((c) => c.stance)),
    new Set(['supports', 'contradicts']),
    'the barrier is cited as contradicting, not quietly as support',
  );
});

test('open on two counts with nothing in the way scores 3', () => {
  assert.equal(scored(scoreC3([row([freeTier, noCard, pricing])])).score, 3);
});

test('an unreadable pricing page is not a way in', () => {
  // free tier alone (1 open signal) with no barriers: supported, not clearly.
  assert.equal(scored(scoreC3([row([freeTier, noPricing])])).score, 2);
});

test('nothing found either way scores 1 and cites the absences', () => {
  const score = scored(scoreC3([row([...c3Absent, noPricing])]));
  assert.equal(score.score, 1);
  assert.deepEqual(new Set(score.citations.map((c) => c.stance)), new Set(['inconclusive']));
  assert.match(score.rationale, /absence of evidence rather than a mark against the product/);
});

test('one evidence row cited for two reasons is cited once, with the stronger stance', () => {
  // The same page both offers a free tier and demands a terminal. The row may
  // appear only once -- finds_verdict_evidence is keyed on (verdict, evidence).
  const score = scored(scoreC3([row([freeTier, terminal])]));
  assert.equal(score.citations.length, 1);
  assert.equal(score.citations[0].stance, 'contradicts');
  assert.match(score.citations[0].note, /open-access.*access-barrier/);
});

test('C3 with no c3_* observation at all is unscoreable', () => {
  const result = scoreC3([row([{ kind: 'c1_corroborated', detail: 'a' }])]);
  assert.equal(result.kind, 'unscoreable');
  assert.equal(result.kind === 'unscoreable' && result.reason, 'no_claims_extracted');
});

test('signals spread across pages are gathered, and the corpus is stated', () => {
  const score = scored(
    scoreC3([row([freeTier], 'https://x/'), row([noCard], 'https://x/pricing'), row([pricing], 'https://x/docs')], 2),
  );
  assert.equal(score.score, 3);
  assert.equal(score.citations.length, 3);
  assert.match(score.rationale, /3 page\(s\) fetched \(3 answered 2xx\), 2 URL\(s\) refused/);
});
