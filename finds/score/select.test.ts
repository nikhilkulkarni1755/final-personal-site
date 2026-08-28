/**
 * What makes a good DAY, not three good scores.
 *
 * Candidates are constructed inline and thrown away (D6). The names and
 * taglines below are shaped to exercise the diversity rules and are not,
 * and must never become, a fixture of real launches.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Criterion, VerdictScore } from '../types.ts';
import { MAX_PER_SOURCE, MAX_PICKS, selectForDay } from './select.ts';
import type { SelectionCandidate } from './select.ts';

let seq = 0;
function candidate(
  name: string,
  scores: Partial<Record<Criterion, VerdictScore>>,
  options: { sources?: string[]; tagline?: string } = {},
): SelectionCandidate {
  seq += 1;
  return {
    candidate_id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name,
    // Unique by default: these tests vary ONE thing at a time, and a shared
    // tagline would silently trip the same-problem-space rule instead.
    tagline: options.tagline ?? `harpy${seq} vireo${seq} plover${seq}`,
    product_url: `https://${seq}.invalid/`,
    evidence_run_id: '11111111-1111-4111-8111-111111111111',
    source_slugs: options.sources ?? ['show_hn'],
    scores,
    // Strictly monotonic, so the tie-break is construction order and these
    // tests are not accidentally order-dependent.
    first_seen_at: `2026-08-28T00:00:00.${String(seq).padStart(3, '0')}Z`,
  };
}

/** Clears the floor comfortably; the tests below vary one thing at a time. */
const STRONG = { C1: 3, C2: 3, C3: 3, C4: 3 } as const;

/* -------------------------------------------------------------------------- */
/* the day is the unit                                                         */
/* -------------------------------------------------------------------------- */

test('a day sends at most three, however much supply there is', () => {
  const monday = Array.from({ length: 40 }, (_, i) =>
    candidate(`Product ${i}`, STRONG, { sources: [`source_${i}`] }),
  );
  const selection = selectForDay('2026-08-24', monday);
  assert.equal(selection.picks.length, MAX_PICKS);
  assert.equal(selection.rejected.filter((r) => r.reason === 'day_full').length, 37);
});

test('a thin day sends what it has and does not pad', () => {
  const selection = selectForDay('2026-08-27', [
    candidate('Only good one', STRONG),
    candidate('Weak', { C1: 1, C2: 1, C3: 1, C4: 1 }),
  ]);
  assert.equal(selection.picks.length, 1);
  assert.equal(selection.rejected[0].reason, 'below_quality_floor');
});

test('a day with nothing worth sending sends nothing, and says why', () => {
  const selection = selectForDay('2026-08-27', [
    candidate('Contradicted', { C1: 0, C2: 3, C3: 3, C4: 3 }),
    candidate('Nothing learned', { C1: 1, C2: 1, C3: 1, C4: 1 }),
  ]);
  assert.equal(selection.picks.length, 0);
  assert.match(selection.summary, /nothing worth sending/);
  assert.match(selection.summary, /1 contradicted, 1 below the quality floor/);
  assert.match(selection.summary, /worth less than no digest/);
});

test('an empty queue is an empty day, not an error', () => {
  const selection = selectForDay('2026-08-27', []);
  assert.equal(selection.picks.length, 0);
  assert.equal(selection.rejected.length, 0);
});

/* -------------------------------------------------------------------------- */
/* the gates                                                                   */
/* -------------------------------------------------------------------------- */

test('a contradicted claim is disqualifying however well it scores elsewhere', () => {
  const selection = selectForDay('2026-08-27', [candidate('Liar', { C1: 0, C2: 3, C3: 3, C4: 3 })]);
  assert.equal(selection.picks.length, 0);
  assert.equal(selection.rejected[0].reason, 'c1_contradicted');
});

test('an unsubstantiated C1 is not disqualifying -- thin docs are not a lie', () => {
  const selection = selectForDay('2026-08-27', [
    candidate('Small honest project', { C1: 1, C2: 3, C3: 3, C4: 2 }),
  ]);
  assert.equal(selection.picks.length, 1);
  assert.equal(selection.rejected.length, 0);
});

test('a partly scored candidate is set aside as unscoreable, not ranked as a loser', () => {
  const selection = selectForDay('2026-08-27', [candidate('Half scored', { C1: 3, C2: 3 })]);
  assert.equal(selection.rejected[0].reason, 'incomplete_scores');
  assert.match(selection.rejected[0].detail, /non-evaluation/);
});

test('one supported criterion out of C2/C3/C4 is not enough', () => {
  const selection = selectForDay('2026-08-27', [candidate('Thin', { C1: 3, C2: 3, C3: 1, C4: 1 })]);
  assert.equal(selection.picks.length, 0);
  assert.equal(selection.rejected[0].reason, 'below_quality_floor');
});

/* -------------------------------------------------------------------------- */
/* diversity -- what stops a Monday being Peerlist's front page                */
/* -------------------------------------------------------------------------- */

test('no single source may supply a whole day', () => {
  const peerlistMonday = Array.from({ length: 5 }, (_, i) =>
    candidate(`Peerlist launch ${i}`, STRONG, { sources: ['peerlist'] }),
  );
  const selection = selectForDay('2026-08-24', peerlistMonday);
  assert.equal(selection.picks.length, MAX_PER_SOURCE);
  assert.ok(selection.rejected.some((r) => r.reason === 'source_quota'));
});

test('a second source fills the third slot the first is not allowed to take', () => {
  const selection = selectForDay('2026-08-24', [
    ...Array.from({ length: 4 }, (_, i) =>
      candidate(`Peerlist ${i}`, STRONG, { sources: ['peerlist'] }),
    ),
    candidate('From elsewhere', STRONG, { sources: ['show_hn'], tagline: 'entirely other subject quokka' }),
  ]);
  assert.equal(selection.picks.length, 3);
  assert.deepEqual(new Set(selection.picks.flatMap((p) => p.source_slugs)), new Set(['peerlist', 'show_hn']));
});

test('a launch cross-posted to a saturated and an unsaturated source still qualifies', () => {
  const selection = selectForDay('2026-08-24', [
    candidate('Peerlist A', STRONG, { sources: ['peerlist'] }),
    candidate('Peerlist B', STRONG, { sources: ['peerlist'] }),
    candidate('Cross posted', STRONG, { sources: ['peerlist', 'uneed'] }),
  ]);
  assert.equal(selection.picks.length, 3);
});

test('two takes on one problem are one find', () => {
  const selection = selectForDay('2026-08-27', [
    candidate('Reviewer', STRONG, { sources: ['show_hn'], tagline: 'automated pull request review for python repos' }),
    candidate('Critic', STRONG, { sources: ['peerlist'], tagline: 'automated review of every python pull request' }),
  ]);
  assert.equal(selection.picks.length, 1);
  const clash = selection.rejected.find((r) => r.reason === 'same_problem_space');
  assert.ok(clash, 'expected the second take to be rejected as the same problem space');
  assert.match(clash.detail, /python/);
});

test('marketing filler is not a problem space', () => {
  const selection = selectForDay('2026-08-27', [
    candidate('Alpha', STRONG, { sources: ['show_hn'], tagline: 'the best free tool to build your teams work faster' }),
    candidate('Beta', STRONG, { sources: ['peerlist'], tagline: 'the best free tool to build your teams work faster' }),
  ]);
  // Identical filler-only taglines share no DISTINCTIVE term, so both stand.
  assert.equal(selection.picks.length, 2);
});

/* -------------------------------------------------------------------------- */
/* reproducible and auditable                                                  */
/* -------------------------------------------------------------------------- */

test('the same candidates in any order produce the same selection', () => {
  const day = [
    candidate('A', { C1: 3, C2: 3, C3: 2, C4: 2 }, { sources: ['uneed'] }),
    candidate('B', STRONG, { sources: ['peerlist'] }),
    candidate('C', { C1: 2, C2: 2, C3: 2, C4: 3 }, { sources: ['show_hn'] }),
    candidate('D', STRONG, { sources: ['github'] }),
  ];
  const forwards = selectForDay('2026-08-27', day);
  const backwards = selectForDay('2026-08-27', [...day].reverse());
  assert.deepEqual(forwards.picks, backwards.picks);
});

test('on an equal total, the find we measured more of ranks first', () => {
  const measured = candidate('Measured', { C1: 3, C2: 3, C3: 3, C4: 1 }, { sources: ['uneed'] });
  const flat = candidate('Flat', { C1: 2, C2: 3, C3: 3, C4: 2 }, { sources: ['peerlist'] });
  const selection = selectForDay('2026-08-27', [flat, measured]);
  assert.deepEqual(selection.picks.map((p) => p.name), ['Measured', 'Flat'], 'three 3s beats two');
});

test('every candidate considered is accounted for, picked or rejected with a reason', () => {
  const day = Array.from({ length: 12 }, (_, i) =>
    candidate(`Product ${i}`, i % 3 === 0 ? { C1: 1, C2: 1, C3: 1, C4: 1 } : STRONG, {
      sources: [`source_${i % 2}`],
    }),
  );
  const selection = selectForDay('2026-08-27', day);
  assert.equal(selection.picks.length + selection.rejected.length, day.length);
  assert.ok(selection.rejected.every((r) => r.detail.length > 0));
});
