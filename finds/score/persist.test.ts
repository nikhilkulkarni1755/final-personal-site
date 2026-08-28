/**
 * The write boundary, in isolation from any database.
 *
 * DECISIONS D7 is enforced by the schema (finds/score/prove-d7.sh watches it
 * abort a real COMMIT). These tests cover the layer above it: that W5 fails
 * early and readably rather than sending Postgres something it will refuse,
 * and -- the one that matters -- that a verdict it cannot state honestly is
 * not stated at all.
 *
 * Rows are constructed inline and thrown away (D6).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CriterionScore } from './types.ts';
import { buildVerdictWrite } from './persist.ts';

const RUN = '00000000-0000-4000-8000-00000000c1a0';
const CANDIDATE = '00000000-0000-4000-8000-00000000cafe';
const EVIDENCE = '00000000-0000-4000-8000-00000000e01d';

const cited: CriterionScore = {
  criterion: 'C1',
  score: 3,
  status: 'corroborated',
  rationale: 'CORROBORATED: every checkable claim is echoed on another page of the site.',
  citations: [{ evidence_id: EVIDENCE, stance: 'supports', note: '4 corroborated claim(s)' }],
  rubric_version: '1.0',
};

test('a write plan is one transaction carrying both the verdict and its citations', () => {
  const plan = buildVerdictWrite(CANDIDATE, RUN, [cited]);
  assert.equal(plan[0].text, 'BEGIN');
  assert.equal(plan.at(-1)?.text, 'COMMIT');
  assert.match(plan[1].text, /DELETE FROM finds_verdict_evidence/);
  assert.match(plan[2].text, /INSERT INTO finds_verdict_evidence/);
  assert.deepEqual(plan[2].values.slice(0, 4), [CANDIDATE, RUN, 'C1', 3]);
  assert.deepEqual(plan[2].values[6], [EVIDENCE]);
  assert.deepEqual(plan[2].values[7], ['supports']);
});

test('the rubric version travels with every verdict', () => {
  const plan = buildVerdictWrite(CANDIDATE, RUN, [cited]);
  assert.match(String(plan[2].values[5]), /^rubric\/\d+\.\d+$/);
  const withModel = buildVerdictWrite(CANDIDATE, RUN, [cited], 'claude-opus-5');
  assert.match(String(withModel[2].values[5]), /^claude-opus-5\+rubric\/\d+\.\d+$/);
});

test('an uncited score cannot even be turned into a write plan', () => {
  assert.throws(
    () => buildVerdictWrite(CANDIDATE, RUN, [{ ...cited, criterion: 'C2', citations: [] }]),
    /cites no evidence/,
  );
});

test("an inconclusive citation is refused rather than written as 'supports'", () => {
  assert.throws(
    () =>
      buildVerdictWrite(CANDIDATE, RUN, [
        { ...cited, score: 1, status: 'unsubstantiated', citations: [{ evidence_id: EVIDENCE, stance: 'inconclusive', note: '3 unsubstantiated claim(s)' }] },
      ]),
    /inconclusive/,
  );
});

test('one plan can carry several criteria, each with its own citations', () => {
  const plan = buildVerdictWrite(CANDIDATE, RUN, [cited, { ...cited, criterion: 'C4', score: 2 }]);
  assert.equal(plan.length, 6);
  assert.deepEqual(
    plan.filter((s) => s.values.length > 0).map((s) => s.values[2]),
    ['C1', 'C1', 'C4', 'C4'],
  );
});
