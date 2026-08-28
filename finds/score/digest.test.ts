/**
 * The handoff to the send.
 *
 * `EmailCriterion` used to type its verdict as a boolean, and this file used to
 * test the mitigations for that. W6 has widened it to `score` plus C1's
 * `status`, so what is tested now is that the distinction the scorer computed
 * arrives intact rather than being reconstructed from prose.
 *
 * Constructed inline and thrown away (D6).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Criterion, VerdictScore } from '../types.ts';
import { toDigestSelection } from './digest.ts';
import { selectForDay } from './select.ts';
import type { SelectionCandidate } from './select.ts';

let seq = 0;
function candidate(name: string, scores: Record<Criterion, VerdictScore>): SelectionCandidate {
  seq += 1;
  return {
    candidate_id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name,
    tagline: null,
    product_url: `https://${seq}.invalid/`,
    evidence_run_id: '11111111-1111-4111-8111-111111111111',
    source_slugs: ['show_hn'],
    scores,
    rationales: {
      C1: 'CORROBORATED: 4 of 5 checkable claims are echoed on another page.',
      C2: 'PARTIALLY SUPPORTED: the site states the problem it solves. Rubric 1.0 caps C2 at 2.',
      C3: 'CLEARLY SUPPORTED: a free tier and no card required.',
      C4: 'NO EVIDENCE: no llms.txt, no linked spec, no MCP endpoint.',
    },
    first_seen_at: `2026-08-28T00:00:00.${String(seq).padStart(3, '0')}Z`,
  };
}

test('a day with no picks produces no digest, not an empty one', () => {
  assert.equal(toDigestSelection(selectForDay('2026-08-27', [])), null);
});

test('the four criteria are carried in C1..C4 order, with their rationales', () => {
  const { digest } = toDigestSelection(
    selectForDay('2026-08-27', [candidate('A find', { C1: 3, C2: 2, C3: 3, C4: 1 })]),
  )!;
  assert.equal(digest.date, '2026-08-27');
  assert.deepEqual(
    digest.finds[0].criteria.map((c) => c.id),
    ['C1', 'C2', 'C3', 'C4'],
  );
  assert.match(digest.finds[0].criteria[2].evidence, /free tier and no card/);
});

test('a score of 1 travels as a 1, with no boolean to flatten it', () => {
  const { digest } = toDigestSelection(
    selectForDay('2026-08-27', [candidate('A find', { C1: 3, C2: 2, C3: 3, C4: 1 })]),
  )!;
  const c4 = digest.finds[0].criteria[3];
  assert.equal(c4.score, 1);
  assert.ok(!('verdict' in c4), 'the boolean is gone; W6 renders the score itself');
  // The prefix that used to apologise for the boolean is gone with it: the
  // rubric's own rationale already opens with the finding.
  assert.match(c4.evidence, /^NO EVIDENCE:/);
});

test("C1's three-way status rides along, and only C1's", () => {
  const { digest } = toDigestSelection(
    selectForDay('2026-08-27', [candidate('A find', { C1: 1, C2: 2, C3: 3, C4: 2 })]),
  )!;
  const [c1, c2] = digest.finds[0].criteria;
  assert.equal(c1.status, 'unsubstantiated', 'the distinction a score alone cannot carry');
  assert.equal(c2.status, undefined);
});

test("the rubric's own cap reaches the reader, so C2 does not look like a mysterious tie", () => {
  const { digest } = toDigestSelection(
    selectForDay('2026-08-27', [candidate('A find', { C1: 3, C2: 2, C3: 3, C4: 2 })]),
  )!;
  assert.match(digest.finds[0].criteria[1].evidence, /caps C2 at 2/);
});

test('candidate ids line up with the finds, because send.ts refuses to guess', () => {
  const selection = selectForDay('2026-08-27', [
    candidate('One', { C1: 3, C2: 2, C3: 3, C4: 2 }),
    candidate('Two', { C1: 3, C2: 2, C3: 3, C4: 2 }),
  ]);
  const handoff = toDigestSelection(selection)!;
  assert.equal(handoff.candidateIds.length, handoff.digest.finds.length);
  assert.deepEqual(handoff.candidateIds, selection.picks.map((p) => p.candidate_id));
});

test('a contradicted criterion can never reach the digest at all', () => {
  assert.equal(
    toDigestSelection(selectForDay('2026-08-27', [candidate('Liar', { C1: 0, C2: 3, C3: 3, C4: 3 })])),
    null,
  );
});
