/**
 * The entry point, and the thing it exists to protect: a non-evaluation must
 * never come out looking like a low score.
 *
 * Evidence is constructed inline and thrown away (D6).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceObservation, EvidenceRow } from '../types.ts';
import { scoreCandidate } from './score.ts';

const CANDIDATE = '00000000-0000-4000-8000-00000000cafe';
const RUN = '00000000-0000-4000-8000-00000000a110';
const STALE = '00000000-0000-4000-8000-00000000dead';

let seq = 0;
function row(observations: EvidenceObservation[], crawl_run_id = RUN): EvidenceRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    candidate_id: CANDIDATE,
    crawl_verdict_id: '00000000-0000-4000-8000-0000000000a1',
    crawl_run_id,
    url: `https://x/${seq}`,
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

const everyPass: EvidenceObservation[] = [
  { kind: 'c1_corroborated', detail: 'a claim is echoed', value: 'https://x/docs' },
  { kind: 'c2_problem_statement', detail: 'why we built this', value: 'https://x/' },
  { kind: 'c2_named_alternatives', detail: 'names 0', value: 0 },
  { kind: 'c3_free_tier', detail: 'free tier', value: 'https://x/' },
  { kind: 'c3_no_card_required', detail: 'no card', value: 'https://x/' },
  { kind: 'c3_pricing_page', detail: 'readable', value: 'https://x/pricing' },
  { kind: 'c4_mcp_endpoint_linked', detail: 'linked', value: 'https://x/mcp' },
];

test('a fully collected generation scores all four criteria', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [row(everyPass)],
  });
  assert.equal(outcome.kind, 'scored');
  assert.deepEqual(
    outcome.kind === 'scored' ? outcome.scores.map((s) => s.criterion) : [],
    ['C1', 'C2', 'C3', 'C4'],
  );
});

test('an ai-input reservation is a non-evaluation, not a rejection and not a zero', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'not_evaluable',
    evidence_run_id: RUN,
    rows: [row(everyPass)],
  });
  assert.equal(outcome.kind, 'unscoreable');
  assert.equal(outcome.kind === 'unscoreable' && outcome.reason, 'not_evaluable');
  assert.match(outcome.kind === 'unscoreable' ? outcome.detail : '', /never a low score and never a rejection/);
});

test('a gate-blocked candidate is distinguishable from one we scored badly', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'gate_blocked',
    evidence_run_id: RUN,
    rows: [],
  });
  assert.equal(outcome.kind === 'unscoreable' && outcome.reason, 'gate_denied');
});

test('an uncrawled candidate is a queue state, not a finding', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'new',
    evidence_run_id: RUN,
    rows: [],
  });
  assert.equal(outcome.kind === 'unscoreable' && outcome.reason, 'no_evidence');
});

test('only the named generation is scored -- a stale crawl cannot contaminate it', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [row(everyPass, STALE)],
  });
  assert.equal(outcome.kind === 'unscoreable' && outcome.reason, 'no_evidence');
});

test('a partly collected generation returns what it has, unpadded', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    // C1 and C4 collected; the C2 and C3 passes left nothing.
    rows: [row([everyPass[0], everyPass[6]])],
  });
  assert.equal(outcome.kind, 'scored');
  assert.deepEqual(outcome.kind === 'scored' ? outcome.scores.map((s) => s.criterion) : [], ['C1', 'C4']);
});

test('evidence that no criterion can read is unscoreable, not four 1s', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [row([{ kind: 'rendered_with_browser', detail: 'SPA' }])],
  });
  assert.equal(outcome.kind === 'unscoreable' && outcome.reason, 'no_claims_extracted');
});

/* -------------------------------------------------------------------------- */
/* W3's question: can a verdict cite evidence from a generation it did not     */
/* score? The composite FK gives same-CANDIDATE, not same-GENERATION.          */
/* -------------------------------------------------------------------------- */

test('no citation can name a row outside the generation being scored', () => {
  // Two generations of the same candidate, both carrying full c1-c4 signals.
  // If anything cited across runs, this is where it would show.
  const current = row(everyPass, RUN);
  const stale = row(everyPass, STALE);
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [stale, current, row(everyPass, STALE)],
  });
  assert.equal(outcome.kind, 'scored');
  if (outcome.kind !== 'scored') return;

  const inGeneration = new Set([current.id]);
  for (const score of outcome.scores) {
    for (const citation of score.citations) {
      assert.ok(
        inGeneration.has(citation.evidence_id),
        `${score.criterion} cited ${citation.evidence_id}, which is not in generation ${RUN}`,
      );
    }
  }
});

test('the generation filter is the single choke point, so this cannot regress quietly', () => {
  // scoreCandidate() narrows with generation() BEFORE any criterion sees a row,
  // and every citation is built from a row the criterion was handed. So the
  // property above holds by construction rather than by four separate careful
  // implementations -- which is what makes W3's same-run constraint safe to add.
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: STALE,
    rows: [row(everyPass, RUN)],
  });
  assert.equal(outcome.kind === 'unscoreable' && outcome.reason, 'no_evidence');
});

/* -------------------------------------------------------------------------- */
/* D24: rendering is off, so a JS app comes back as an empty shell             */
/* -------------------------------------------------------------------------- */

/** What W4 actually records over an unrendered shell: the shell marker, and a
 *  full set of C2/C3/C4 ABSENCES, because every pattern misses on empty text. */
const shellWithAbsences: EvidenceObservation[] = [
  { kind: 'spa_shell_not_rendered', detail: 'a plain GET returned 41 characters of text', value: 41 },
  { kind: 'c2_problem_statement_absent', detail: 'no such statement', value: false },
  { kind: 'c2_named_alternatives', detail: 'names none', value: 0 },
  { kind: 'c3_free_tier_absent', detail: 'none found', value: false },
  { kind: 'c3_no_card_required_absent', detail: 'none found', value: false },
  { kind: 'c3_pricing_page', detail: 'no pricing page was permitted', value: null },
  { kind: 'c4_api_absent', detail: 'not mentioned', value: false },
  { kind: 'c4_llms_txt_absent', detail: 'never reachable', value: null },
];

test('a site we could not read is not scored at all, in either direction', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [row(shellWithAbsences)],
  });
  assert.equal(outcome.kind, 'unscoreable');
  assert.equal(outcome.kind === 'unscoreable' && outcome.reason, 'not_rendered');
});

test('the absences over an empty shell must NOT become three verdicts of 1', () => {
  // The failure this guard exists to prevent: C2/C3/C4 pattern-match over the
  // corpus and record every miss explicitly, so without the guard this evidence
  // yields "no evidence either way" for a free tier, an API and a problem
  // statement -- three findings about a page we never received.
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [row(shellWithAbsences)],
  });
  assert.notEqual(outcome.kind, 'scored', 'no verdict may be written about an unreadable page');
});

test('a shell that still yielded claims IS scored -- the guard is about readability, not the marker', () => {
  // A page can be flagged as a shell and still have had claims extracted (a
  // partial render, or a sub-page that carried the text). Then C1 has a real
  // left-hand side and there is something honest to score.
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [row([...shellWithAbsences, { kind: 'c1_corroborated', detail: 'a claim is echoed', value: 'https://x/docs' }])],
  });
  assert.equal(outcome.kind, 'scored');
});

test('a readable page with genuine absences still scores them -- the guard is not a blanket', () => {
  const outcome = scoreCandidate({
    candidate_id: CANDIDATE,
    candidate_status: 'crawled',
    evidence_run_id: RUN,
    rows: [row(shellWithAbsences.filter((o) => o.kind !== 'spa_shell_not_rendered').concat(everyPass[0]))],
  });
  assert.equal(outcome.kind, 'scored');
});
