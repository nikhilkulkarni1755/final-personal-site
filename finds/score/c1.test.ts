/**
 * The C1 rubric's logic, against evidence constructed inline here and thrown
 * away (DECISIONS D6 -- this is a test, not a fixture, and nothing in it may
 * reach a table or a digest).
 *
 * What these prove is the JUDGMENT, not the pipeline: that a contradiction
 * disqualifies, that an absence of evidence is never scored as a lie, that the
 * same rows always produce the same number, and that a score which cannot cite
 * evidence refuses to be written. Proving the same rubric against evidence W4
 * actually crawled is a separate, later claim -- see lanes/W5.md, which keeps
 * the two apart on purpose.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceObservation, EvidencePageRole, EvidenceRow } from '../types.ts';
import { scoreC1 } from './c1.ts';
import { generation } from './rubric.ts';

const RUN = '00000000-0000-4000-8000-00000000c1a0';
const CANDIDATE = '00000000-0000-4000-8000-00000000cafe';

let seq = 0;
function row(url: string, page_role: EvidencePageRole, observations: EvidenceObservation[], crawl_run_id = RUN): EvidenceRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    candidate_id: CANDIDATE,
    crawl_verdict_id: '00000000-0000-4000-8000-0000000000a1',
    crawl_run_id,
    url,
    page_role,
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

const corroborated = (n: number): EvidenceObservation[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'c1_corroborated', detail: `claim ${i} echoed`, value: 'https://x/docs' }));
const unsubstantiated = (n: number): EvidenceObservation[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'c1_unsubstantiated', detail: `claim ${i} unsettled`, value: null }));
const contradicted = (n: number): EvidenceObservation[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'c1_contradicted', detail: `claim ${i} contradicted`, value: 'https://x/pricing' }));

function scored(result: ReturnType<typeof scoreC1>) {
  assert.equal(result.kind, 'scored', `expected a score, got ${JSON.stringify(result)}`);
  return (result as Extract<typeof result, { kind: 'scored' }>).score;
}

/* -------------------------------------------------------------------------- */
/* the rule that protects the feed: a contradiction disqualifies               */
/* -------------------------------------------------------------------------- */

test('a contradicted claim scores 0 and cites what contradicts it', () => {
  const score = scored(scoreC1([row('https://x/', 'homepage', contradicted(1))]));
  assert.equal(score.score, 0);
  assert.equal(score.status, 'contradicted');
  assert.deepEqual(
    score.citations.map((c) => c.stance),
    ['contradicts'],
  );
  assert.match(score.rationale, /CONTRADICTED/);
});

test('one contradiction outranks any amount of corroboration', () => {
  const score = scored(
    scoreC1([
      row('https://x/', 'homepage', corroborated(20)),
      row('https://x/pricing', 'pricing', contradicted(1)),
    ]),
  );
  assert.equal(score.score, 0);
  assert.equal(score.status, 'contradicted');
  // The citations point at the contradiction, not at the 20 things that agreed.
  assert.equal(score.citations.length, 1);
});

/* -------------------------------------------------------------------------- */
/* the rule that protects small honest projects: absence is not a lie          */
/* -------------------------------------------------------------------------- */

test('claims nobody could settle score 1, never 0', () => {
  const score = scored(scoreC1([row('https://x/', 'homepage', unsubstantiated(9))]));
  assert.equal(score.score, 1);
  assert.equal(score.status, 'unsubstantiated');
  assert.notEqual(score.status, 'contradicted');
  assert.deepEqual(
    score.citations.map((c) => c.stance),
    ['inconclusive'],
  );
  assert.match(score.rationale, /absence of evidence, not evidence against the product/);
});

test('evidence with no claims diff at all is unscoreable, not a 1', () => {
  const result = scoreC1([row('https://x/', 'homepage', [{ kind: 'mcp_endpoint', detail: 'GET /mcp -> 200' }])]);
  assert.equal(result.kind, 'unscoreable');
  assert.equal(result.kind === 'unscoreable' && result.reason, 'no_claims_extracted');
});

test('no evidence at all is unscoreable, not a 1', () => {
  const result = scoreC1([]);
  assert.equal(result.kind, 'unscoreable');
  assert.equal(result.kind === 'unscoreable' && result.reason, 'no_evidence');
});

/* -------------------------------------------------------------------------- */
/* the two strengths of corroboration                                          */
/* -------------------------------------------------------------------------- */

test('a partial diff scores 2 and cites only the corroborating rows', () => {
  const score = scored(
    scoreC1([row('https://x/', 'homepage', [...corroborated(2), ...unsubstantiated(8)])]),
  );
  assert.equal(score.score, 2);
  assert.equal(score.status, 'corroborated');
  assert.match(score.rationale, /partial/);
  assert.deepEqual(score.citations.map((c) => c.stance), ['supports']);
});

test('3 corroborated at >=60% scores 3', () => {
  const score = scored(scoreC1([row('https://x/', 'homepage', [...corroborated(3), ...unsubstantiated(1)])]));
  assert.equal(score.score, 3);
});

test('a perfect ratio on too few claims stays at 2 -- one echo can be coincidence', () => {
  const score = scored(scoreC1([row('https://x/', 'homepage', corroborated(2))]));
  assert.equal(score.score, 2);
});

test('volume cannot buy a 3: 3 corroborated out of 30 is still partial', () => {
  const score = scored(scoreC1([row('https://x/', 'homepage', [...corroborated(3), ...unsubstantiated(27)])]));
  assert.equal(score.score, 2);
});

/* -------------------------------------------------------------------------- */
/* reproducible, and honest about the corpus                                   */
/* -------------------------------------------------------------------------- */

test('the same evidence in a different order produces an identical verdict', () => {
  const rows = [
    row('https://x/docs', 'docs', corroborated(2)),
    row('https://x/', 'homepage', unsubstantiated(3)),
    row('https://x/pricing', 'pricing', corroborated(2)),
  ];
  const forwards = scored(scoreC1(generation(rows, RUN)));
  const backwards = scored(scoreC1(generation([...rows].reverse(), RUN)));
  assert.deepEqual(forwards, backwards);
});

test('scoring one generation ignores the rows of another', () => {
  const rows = [
    row('https://x/', 'homepage', corroborated(4), RUN),
    row('https://x/', 'homepage', contradicted(1), '00000000-0000-4000-8000-00000000dead'),
  ];
  const score = scored(scoreC1(generation(rows, RUN)));
  assert.equal(score.score, 3, 'a stale generation must not contaminate this one');
});

test('every rationale states how much we were allowed to read', () => {
  const score = scored(scoreC1([row('https://x/', 'homepage', unsubstantiated(4))], 6));
  assert.match(score.rationale, /1 page\(s\) fetched \(1 answered 2xx\), 6 URL\(s\) refused/);
});
