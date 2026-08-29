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
import type { NoveltyJudgement } from './novelty.ts';
import { bindClaim, requireApiKey } from './novelty.ts';
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

const CLAIM = 'The AI Cursor for Motion Design';
function claimRow(observations: EvidenceObservation[] = [problemStated]): EvidenceRow {
  return { ...row(observations), claims: [{ text: CLAIM, locator: 'h1' }] };
}
function judgement(over: Partial<NoveltyJudgement> & { evidence_id: string }): NoveltyJudgement {
  return {
    form: 'established', prior_art: null, reason: 'because', cited_claim: CLAIM,
    model: 'claude-opus-5', ...over,
  };
}

test('named prior art is a 0, and the citation contradicts', () => {
  const r = claimRow();
  const score = scored(scoreC2([r], judgement({ evidence_id: r.id, form: 'established', prior_art: 'After Effects' })));
  assert.equal(score.score, 0);
  assert.deepEqual(score.citations.map((c) => c.stance), ['contradicts']);
  assert.match(score.rationale, /already done by After Effects/);
  assert.match(score.rationale, /however narrow the niche/, 'narrow is not novel');
});

test('D37 form (1), a fusion of two established apps, scores 2', () => {
  const r = claimRow();
  const score = scored(scoreC2([r], judgement({ evidence_id: r.id, form: 'fusion' })));
  assert.equal(score.score, 2);
  assert.match(score.rationale, /form \(1\)/);
  assert.deepEqual(score.citations.map((c) => c.stance), ['supports']);
});

test('D37 forms (2) and (3) score 3', () => {
  const r = claimRow();
  assert.equal(scored(scoreC2([r], judgement({ evidence_id: r.id, form: 'new_paradigm' }))).score, 3);
  assert.equal(scored(scoreC2([r], judgement({ evidence_id: r.id, form: 'new_task' }))).score, 3);
});

test('every C2 verdict quotes the claim it rests on and names its judge', () => {
  const r = claimRow();
  for (const form of ['established', 'fusion', 'new_paradigm'] as const) {
    const score = scored(scoreC2([r], judgement({ evidence_id: r.id, form, prior_art: 'Something' })));
    assert.match(score.rationale, /It rests on the product's own claim: "The AI Cursor for Motion Design"/);
    assert.match(score.rationale, /Judged by claude-opus-5 under rubric/);
    assert.deepEqual(score.citations.map((c) => c.evidence_id), [r.id]);
  }
});

/* -- the failure modes that must never become an accusation ---------------- */

test('no judgement scores 1, never 0', () => {
  const score = scored(scoreC2([claimRow()], null));
  assert.equal(score.score, 1);
  assert.notEqual(score.score, 0);
  assert.deepEqual(score.citations.map((c) => c.stance), ['inconclusive']);
});

test('an unsure judgement scores 1, never 0', () => {
  const r = claimRow();
  const score = scored(scoreC2([r], judgement({ evidence_id: r.id, form: 'unsure' })));
  assert.equal(score.score, 1);
  assert.match(score.rationale, /not a mark against the product/);
});

test('a form other than established can never carry prior art into the rationale', () => {
  const r = claimRow();
  const score = scored(scoreC2([r], judgement({ evidence_id: r.id, form: 'fusion', prior_art: 'Hallucinated Inc' })));
  assert.doesNotMatch(score.rationale, /Hallucinated Inc/);
});

test('an absent problem statement still lets a no-judgement C2 score 1, not vanish', () => {
  const r = { ...row([{ kind: 'c2_problem_statement_absent', detail: 'none', value: false }]), claims: [] };
  assert.equal(scored(scoreC2([r], null)).score, 1);
});

test('C2 with no judgement and no c2_* observation is unscoreable', () => {
  const result = scoreC2([row([{ kind: 'c1_corroborated', detail: 'a' }])], null);
  assert.equal(result.kind, 'unscoreable');
  assert.equal(result.kind === 'unscoreable' && result.reason, 'no_claims_extracted');
});

/* -- trap 4: the instrument failing in its new form ------------------------ */

test('a fabricated claim is rejected outright, not scored on trust', () => {
  // The model quoting text we never sent is the hallucination we CAN detect
  // mechanically. bindClaim returns null and judgeNovelty discards the verdict.
  const supplied = [{ row: claimRow(), claim: { text: CLAIM } }];
  assert.equal(bindClaim('A claim nobody ever made', supplied), null);
  assert.equal(bindClaim(CLAIM, supplied)?.claim.text, CLAIM);
});

test('a re-quoted claim differing only in whitespace still binds', () => {
  const supplied = [{ row: claimRow(), claim: { text: CLAIM } }];
  assert.equal(bindClaim(`  The AI   Cursor for Motion Design `, supplied)?.claim.text, CLAIM);
});

test('binding is not fuzzy: a near-miss must NOT bind', () => {
  // A "close enough" match is how a fabricated claim gets accepted.
  const supplied = [{ row: claimRow(), claim: { text: CLAIM } }];
  assert.equal(bindClaim('The AI Cursor for Video Design', supplied), null);
});

test('an absent API key is a hard stop, not a silent pattern fallback', () => {
  const saved = [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN];
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    assert.throws(() => requireApiKey(), /hard stop, not a skip/);
    assert.throws(() => requireApiKey(), /no pattern fallback/);
  } finally {
    if (saved[0]) process.env.ANTHROPIC_API_KEY = saved[0];
    if (saved[1]) process.env.ANTHROPIC_AUTH_TOKEN = saved[1];
  }
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

/* -- rubric 1.2: usability is the DEFAULT, barriers subtract ---------------- */

test('nothing in the way scores 2, even with nothing published inviting you in', () => {
  // The inversion 1.2 fixes. AircoAlert and Thuki are trivially usable and
  // scored 1 under 1.1 purely for having no pricing page.
  const score = scored(scoreC3([row([...c3Absent, noPricing])]));
  assert.equal(score.score, 2);
  assert.match(score.rationale, /"usable by any person" is the default/);
  assert.deepEqual(new Set(score.citations.map((c) => c.stance)), new Set(['supports']),
    'a barrier looked for and not found is positive evidence, not an inconclusive one');
});

test('a missing pricing page is not a penalty, and a present one is not a credit', () => {
  const withPricing = scored(scoreC3([row([...c3Absent, pricing])]));
  const without = scored(scoreC3([row([...c3Absent, noPricing])]));
  assert.equal(withPricing.score, without.score, 'the pricing page must move nothing');
  assert.equal(withPricing.score, 2);
});

test('nothing in the way plus an explicit way in scores 3', () => {
  assert.equal(scored(scoreC3([row([...c3Absent, freeTier])])).score, 3);
  assert.equal(scored(scoreC3([row([freeTier, noCard, pricing])])).score, 3);
});

test('one barrier with a way past it is still supported', () => {
  const score = scored(scoreC3([row([freeTier, noCard]), row([terminal], 'https://x/docs')]));
  assert.equal(score.score, 2);
  assert.deepEqual(
    new Set(score.citations.map((c) => c.stance)),
    new Set(['supports', 'contradicts']),
    'the barrier is cited as contradicting, not quietly as support',
  );
});

test('one barrier and nothing published past it scores 1', () => {
  const score = scored(scoreC3([row([terminal, { kind: 'c3_free_tier_absent', detail: 'none', value: false }])]));
  assert.equal(score.score, 1);
  assert.match(score.rationale, /nothing on the other side of the scale/);
});

test('one evidence row cited for two reasons is cited once, with the stronger stance', () => {
  // The same page both offers a free tier and demands a terminal. The row may
  // appear only once -- finds_verdict_evidence is keyed on (verdict, evidence).
  const score = scored(scoreC3([row([freeTier, terminal])]));
  assert.equal(score.citations.length, 1);
  assert.equal(score.citations[0].stance, 'contradicts');
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
  assert.equal(score.citations.length, 2, 'the pricing-page row is not cited: it is evidence of nothing');
  assert.match(score.rationale, /3 page\(s\) fetched \(3 answered 2xx\), 2 URL\(s\) refused/);
});
