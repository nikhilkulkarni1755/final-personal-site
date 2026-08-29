/**
 * The two places persist.ts refuses to write rather than fill a gap.
 *
 * Both matter because `finds_crawl_verdicts` rows are the answer to "why did
 * you crawl me". A guessed field there is not a small inaccuracy, it is a false
 * answer to the one question the table exists for.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { checkPage } from '../gate/gate.ts';
import { verdictRowFor } from './persist.ts';
import type { GateDecision } from './types.ts';

/** A real decision from the real gate, decided offline by P1. No network. */
async function realDecision(): Promise<GateDecision> {
  const verdict = await checkPage('http://127.0.0.1:1/');
  return {
    url: verdict.url,
    authority: verdict.authority,
    allowed: verdict.allowed,
    reason_code: verdict.reason_code,
    reason_detail: verdict.reason_detail,
    deciding_signal: verdict.deciding_signal,
    deciding_rule: verdict.deciding_rule,
    deciding_group: verdict.deciding_group,
    precedence_rule: verdict.precedence_rule,
    use_rights: verdict.use_rights,
    crawl_budget: { delay_ms: 2000, delay_source: 'DEFAULT', page_cap: 25, depth_cap: 2, wall_clock_ms: 300_000 },
    robots: {},
    rubric_version: verdict.rubric_version,
    gate_version: verdict.gate_version,
    decided_at: verdict.decided_at,
    expires_at: verdict.expires_at,
    gate_requests: verdict.evidence.length,
    page: { kind: 'not_fetched' },
  };
}

const CANDIDATE = '11111111-2222-3333-4444-555555555555';

describe('a verdict row is never invented', () => {
  it('maps a real gate decision straight through', async () => {
    const decision = await realDecision();
    const row = verdictRowFor(CANDIDATE, decision);

    assert.equal(row.candidate_id, CANDIDATE);
    assert.equal(row.allowed, false);
    assert.equal(row.reason_code, 'url_out_of_scope');
    assert.equal(row.registrable_domain, '127.0.0.1');
    assert.equal(row.reason_detail, decision.reason_detail, 'the gate wrote this, not W4');
    assert.equal(row.rubric_version, decision.rubric_version);
  });

  it('refuses to persist a decision the gate did not explain', async () => {
    const decision = { ...(await realDecision()), reason_code: null };
    assert.throws(() => verdictRowFor(CANDIDATE, decision), /will not invent one/);
  });

  it('refuses a null expires_at unless a human made the decision (R2 §7)', async () => {
    const base = await realDecision();
    assert.throws(
      () => verdictRowFor(CANDIDATE, { ...base, reason_code: 'robots_disallow', expires_at: null }),
      /only for manual_denylist/,
    );
    assert.doesNotThrow(() =>
      verdictRowFor(CANDIDATE, { ...base, reason_code: 'manual_denylist', expires_at: null }),
    );
  });
});


describe('every evidence row is insertable in the same statement as the others', () => {
  /**
   * The bug the first production run found. PostgREST unifies the column set
   * across a bulk INSERT, so because the landing-page row supplies `claims`,
   * every other row in the batch gets `claims` as an explicit null -- and the
   * column is NOT NULL. Relying on the database default only works while NO
   * row in the batch sets the column, which stops being true the moment the
   * C1 diff attaches anything.
   */
  it('carries claims, quotes and observations on every row, even when empty', async () => {
    const { crawlCandidate } = await import('./crawl.ts');
    // Denied at P1 offline, so this reaches the row builder without a fetch.
    const result = await crawlCandidate({ candidateId: CANDIDATE, productUrl: 'http://10.0.0.5/' });
    assert.ok(result.records.length > 0);
    for (const record of result.records) {
      const row = record.evidence;
      assert.ok(Array.isArray(row.claims), `${row.url} must not leave claims undefined`);
      assert.ok(Array.isArray(row.quotes), `${row.url} must not leave quotes undefined`);
      assert.ok(Array.isArray(row.observations), `${row.url} must not leave observations undefined`);
    }
  });

  it('keeps the three arrays present across the whole batch, not just the first row', async () => {
    const { crawlCandidate } = await import('./crawl.ts');
    const result = await crawlCandidate({ candidateId: CANDIDATE, productUrl: 'http://10.0.0.5/' });
    const columns = new Set<string>();
    for (const record of result.records) for (const key of Object.keys(record.evidence)) columns.add(key);
    // Whatever the union of columns is, every row must supply the NOT NULL ones.
    for (const required of ['claims', 'quotes', 'observations']) {
      assert.ok(columns.has(required));
      for (const record of result.records) {
        assert.ok(required in record.evidence, `${record.evidence.url} is missing ${required}`);
      }
    }
  });
});
