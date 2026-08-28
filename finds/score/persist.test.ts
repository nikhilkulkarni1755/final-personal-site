/**
 * The write boundary, in isolation from any database.
 *
 * DECISIONS D7 is enforced by the schema and by finds_write_verdict
 * (finds/score/prove-d7.sh watches both refuse a real COMMIT). These tests
 * cover the layer above: that W5 fails early and readably rather than sending
 * the database something it will refuse,
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

test('the payload names the candidate, the generation, and every citation', () => {
  const args = buildVerdictWrite(CANDIDATE, RUN, [cited]);
  assert.equal(args.p_candidate_id, CANDIDATE);
  assert.equal(args.p_evidence_run_id, RUN);
  assert.equal(args.p_verdicts.length, 1);
  assert.equal(args.p_verdicts[0].criterion, 'C1');
  assert.equal(args.p_verdicts[0].score, 3);
  assert.deepEqual(args.p_verdicts[0].citations, [{ evidence_id: EVIDENCE, stance: 'supports' }]);
});

test('the payload is JSON-serialisable, because that is how it crosses the wire', () => {
  const args = buildVerdictWrite(CANDIDATE, RUN, [cited]);
  assert.deepEqual(JSON.parse(JSON.stringify(args)), args);
});

test('the rubric version travels with every verdict', () => {
  assert.match(buildVerdictWrite(CANDIDATE, RUN, [cited]).p_verdicts[0].scored_by, /^rubric\/\d+\.\d+$/);
  assert.match(
    buildVerdictWrite(CANDIDATE, RUN, [cited], 'claude-opus-5').p_verdicts[0].scored_by,
    /^claude-opus-5\+rubric\/\d+\.\d+$/,
  );
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

test('one payload can carry several criteria, each with its own citations', () => {
  const args = buildVerdictWrite(CANDIDATE, RUN, [cited, { ...cited, criterion: 'C4', score: 2 }]);
  assert.deepEqual(args.p_verdicts.map((v) => v.criterion), ['C1', 'C4']);
  assert.deepEqual(args.p_verdicts.map((v) => v.score), [3, 2]);
});

test('one evidence row cited twice is refused before Postgres sees it', () => {
  // finds_verdict_evidence is keyed on (verdict_id, evidence_id). Two citations
  // of one row would fail on the primary key; mergeCitations() is the fix and
  // this is the guard that says so.
  assert.throws(
    () =>
      buildVerdictWrite(CANDIDATE, RUN, [
        {
          ...cited,
          citations: [
            { evidence_id: EVIDENCE, stance: 'supports', note: 'a free tier' },
            { evidence_id: EVIDENCE, stance: 'contradicts', note: 'and a terminal' },
          ],
        },
      ]),
    /more than once/,
  );
});
