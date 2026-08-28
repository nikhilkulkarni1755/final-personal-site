/**
 * The handoff to the send, and the one lossy conversion in it.
 *
 * Constructed inline and thrown away (D6).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Criterion, VerdictScore } from '../types.ts';
import { toDigestInput } from './digest.ts';
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
      C2: 'PARTIALLY SUPPORTED: the site states the problem it solves.',
      C3: 'CLEARLY SUPPORTED: a free tier and no card required.',
      C4: 'NO EVIDENCE: no llms.txt, no linked spec, no MCP endpoint.',
    },
    first_seen_at: `2026-08-28T00:00:00.${String(seq).padStart(3, '0')}Z`,
  };
}

test('a day with no picks produces no digest, not an empty one', () => {
  assert.equal(toDigestInput(selectForDay('2026-08-27', [])), null);
});

test('the four criteria are carried in C1..C4 order, with their rationales', () => {
  const selection = selectForDay('2026-08-27', [candidate('A find', { C1: 3, C2: 2, C3: 3, C4: 1 })]);
  const digest = toDigestInput(selection)!;
  assert.equal(digest.date, '2026-08-27');
  assert.deepEqual(digest.finds[0].criteria.map((c) => c.id), ['C1', 'C2', 'C3', 'C4']);
  assert.match(digest.finds[0].criteria[2].evidence, /free tier and no card/);
});

test("a score of 1 renders as false, so its evidence line says so in words", () => {
  const digest = toDigestInput(selectForDay('2026-08-27', [candidate('A find', { C1: 3, C2: 2, C3: 3, C4: 1 })]))!;
  const c4 = digest.finds[0].criteria[3];
  assert.equal(c4.verdict, false, "W6's boolean cannot express 'no evidence' -- this is the lossy half");
  assert.match(c4.evidence, /^NO EVIDENCE EITHER WAY -- this is not a failed check\./);
});

test('the 0-3 score travels alongside the boolean, so W6 can adopt it without a new handoff', () => {
  const digest = toDigestInput(selectForDay('2026-08-27', [candidate('A find', { C1: 3, C2: 2, C3: 3, C4: 1 })]))!;
  const carried = digest.finds[0].criteria as unknown as { id: Criterion; score: number; status?: string }[];
  assert.deepEqual(carried.map((c) => c.score), [3, 2, 3, 1]);
  assert.equal(carried[0].status, 'corroborated', 'C1 keeps its three-way distinction');
  assert.equal(carried[1].status, undefined, 'only C1 has one');
});

test('a contradicted criterion can never reach the digest at all', () => {
  // Selection disqualifies any 0, which is what keeps the boolean from ever
  // having to represent CONTRADICTED.
  const digest = toDigestInput(selectForDay('2026-08-27', [candidate('Liar', { C1: 0, C2: 3, C3: 3, C4: 3 })]));
  assert.equal(digest, null);
});
