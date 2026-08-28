/**
 * C4's rubric: whether a product is agent-friendly, judged on what was
 * measured rather than what was written.
 *
 * Evidence is constructed inline and thrown away (D6).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceObservation, EvidencePageRole, EvidenceRow } from '../types.ts';
import { scoreC4 } from './c4.ts';

const RUN = '00000000-0000-4000-8000-00000000c4a0';

let seq = 0;
function row(url: string, page_role: EvidencePageRole, observations: EvidenceObservation[]): EvidenceRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    candidate_id: '00000000-0000-4000-8000-00000000cafe',
    crawl_verdict_id: '00000000-0000-4000-8000-0000000000a1',
    crawl_run_id: RUN,
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

const mcpLinked: EvidenceObservation = { kind: 'c4_mcp_endpoint_linked', detail: 'linked', value: 'https://x/mcp' };
// W4 emits BOTH of these when MCP is named in prose with no endpoint linked:
// the advertised signal, and the endpoint row carrying a null value.
const mcpAdvertised: EvidenceObservation = { kind: 'c4_mcp', detail: 'an MCP server is advertised', value: 'https://x/' };
const mcpProseOnly: EvidenceObservation = { kind: 'c4_mcp_endpoint_linked', detail: 'mentioned, never linked', value: null };
const llmsTxt: EvidenceObservation = { kind: 'c4_llms_txt', detail: 'GET /llms.txt -> 200', value: 4211 };
const openapi: EvidenceObservation = { kind: 'c4_openapi_spec_linked', detail: 'linked', value: 'https://x/openapi.json' };
const advertisedApi: EvidenceObservation = { kind: 'c4_api', detail: 'a documented API is advertised', value: 'https://x/' };
const advertisedCli: EvidenceObservation = { kind: 'c4_cli', detail: 'a CLI is advertised', value: 'https://x/' };
const deadStandard: EvidenceObservation = { kind: 'c4_dead_standard_claimed', detail: 'ai-plugin.json', value: 'https://x/' };
const allAbsent: EvidenceObservation[] = [
  { kind: 'c4_llms_txt_absent', detail: 'never reachable', value: null },
  { kind: 'c4_openapi_spec_absent', detail: 'no spec URL anywhere', value: false },
  { kind: 'c4_mcp_absent', detail: 'not mentioned', value: false },
  { kind: 'c4_api_absent', detail: 'not mentioned', value: false },
  { kind: 'c4_cli_absent', detail: 'not mentioned', value: false },
];

function scored(result: ReturnType<typeof scoreC4>) {
  assert.equal(result.kind, 'scored', `expected a score, got ${JSON.stringify(result)}`);
  return (result as Extract<typeof result, { kind: 'scored' }>).score;
}

/* -------------------------------------------------------------------------- */
/* measured beats advertised, and MCP beats everything                         */
/* -------------------------------------------------------------------------- */

test('a linked MCP endpoint alone scores 3 -- it is the criterion he named', () => {
  const score = scored(scoreC4([row('https://x/', 'homepage', [mcpLinked])]));
  assert.equal(score.score, 3);
  assert.match(score.rationale, /measured rather than claimed/);
});

test('MCP named in prose but never linked is a claim, not a measurement', () => {
  const prose = scored(scoreC4([row('https://x/', 'homepage', [mcpAdvertised, mcpProseOnly, advertisedApi])]));
  assert.equal(prose.score, 2, 'two advertised surfaces, nothing measured -- a null-valued MCP row is not a 3');
  assert.match(prose.rationale, /0 measured surface\(s\) and 2 advertised one\(s\)/);
});

test('two measured surfaces score 3 without any MCP at all', () => {
  assert.equal(scored(scoreC4([row('https://x/', 'homepage', [llmsTxt, openapi])])).score, 3);
});

test('one measured surface scores 2', () => {
  assert.equal(scored(scoreC4([row('https://x/', 'homepage', [llmsTxt])])).score, 2);
});

test('two advertised surfaces score 2', () => {
  assert.equal(scored(scoreC4([row('https://x/', 'homepage', [advertisedApi, advertisedCli])])).score, 2);
});

test('one word on a marketing page is not agent-friendliness', () => {
  const score = scored(scoreC4([row('https://x/', 'homepage', [advertisedApi])]));
  assert.equal(score.score, 1);
  assert.deepEqual(score.citations.map((c) => c.stance), ['inconclusive']);
});

/* -------------------------------------------------------------------------- */
/* absence, and dead surfaces                                                  */
/* -------------------------------------------------------------------------- */

test('no agent surfaces at all scores 1, not 0 -- not every good product is for agents', () => {
  const score = scored(scoreC4([row('https://x/', 'homepage', allAbsent)]));
  assert.equal(score.score, 1);
  assert.match(score.rationale, /a product can be excellent and simply not be built for agents/);
  assert.deepEqual(score.citations.map((c) => c.stance), ['inconclusive']);
});

test('a dead standard as the only agent story scores 0 and is cited as contradicting', () => {
  const score = scored(scoreC4([row('https://x/', 'homepage', [...allAbsent, deadStandard])]));
  assert.equal(score.score, 0);
  assert.deepEqual(score.citations.map((c) => c.stance), ['contradicts']);
  assert.match(score.rationale, /argues against it/);
});

test('a dead standard alongside a real one is excluded, not punished', () => {
  const score = scored(scoreC4([row('https://x/', 'homepage', [mcpLinked, deadStandard])]));
  assert.equal(score.score, 3);
  assert.match(score.rationale, /1 dead agent surface\(s\) were advertised and excluded/);
});

test('evidence with no c4_* observation at all is unscoreable, not a 1', () => {
  const result = scoreC4([row('https://x/', 'homepage', [{ kind: 'c1_corroborated', detail: 'a' }])]);
  assert.equal(result.kind, 'unscoreable');
  assert.equal(result.kind === 'unscoreable' && result.reason, 'no_claims_extracted');
});

test('no evidence at all is unscoreable', () => {
  const result = scoreC4([]);
  assert.equal(result.kind, 'unscoreable');
  assert.equal(result.kind === 'unscoreable' && result.reason, 'no_evidence');
});

/* -------------------------------------------------------------------------- */
/* reproducible, and honest about the corpus                                   */
/* -------------------------------------------------------------------------- */

test('signals spread across pages are gathered, and the corpus is stated', () => {
  const score = scored(
    scoreC4(
      [
        row('https://x/', 'homepage', [advertisedApi]),
        row('https://x/docs', 'docs', [openapi]),
        row('https://x/llms.txt', 'llms_txt', [llmsTxt]),
      ],
      4,
    ),
  );
  assert.equal(score.score, 3);
  assert.equal(score.citations.length, 3, 'one citation per evidence row');
  assert.match(score.rationale, /3 page\(s\) fetched \(3 answered 2xx\), 4 URL\(s\) refused/);
});
