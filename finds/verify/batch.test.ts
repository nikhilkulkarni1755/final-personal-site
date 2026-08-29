/**
 * The batch loop's failure policy (D3), proven offline.
 *
 * The two candidates below need no network: a malformed URL throws inside the
 * crawler before anything is fetched, and a loopback address is denied by the
 * gate at P1 with zero bytes sent. So this asserts the policy itself rather
 * than anyone's website.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classify, runVerifyBatch } from './batch.ts';
import { DatastoreError } from './persist.ts';
import type { QueuedCandidate } from './select.ts';

interface StubOptions {
  /** Make the status update fail, the way a dropped connection would. */
  updateError?: string;
}

function stubClient(options: StubOptions = {}): { client: SupabaseClient; updates: string[] } {
  const updates: string[] = [];
  const client = {
    from() {
      return {
        insert: (rows: unknown[]) => ({
          select: async () => ({ data: (rows as unknown[]).map((_, i) => ({ id: `row-${i}` })), error: null }),
        }),
        update: (patch: { status: string }) => ({
          eq: async (_column: string, id: string) => {
            updates.push(`${id}=${patch.status}`);
            return { error: options.updateError ? { message: options.updateError } : null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { client, updates };
}

const BROKEN: QueuedCandidate = {
  id: 'broken',
  product_url: 'not-a-url',
  name: 'Malformed URL',
  first_seen_at: '2026-08-28T10:00:00Z',
  product_url_kind: 'unknown',
  sightings: 1,
};

/** Denied by the gate at P1, offline, with no request issued. */
const LOOPBACK: QueuedCandidate = {
  id: 'loopback',
  product_url: 'http://127.0.0.1:1/',
  name: 'Loopback',
  first_seen_at: '2026-08-28T09:00:00Z',
  product_url_kind: 'dedicated',
  sightings: 1,
};

describe('one bad candidate does not kill the run', () => {
  it('records the failure and carries on to the next candidate', async () => {
    const { client, updates } = stubClient();
    const summary = await runVerifyBatch({
      client,
      queue: [BROKEN, LOOPBACK],
      budgetMs: 10 * 60_000,
      log: () => {},
      warn: () => {},
    });

    assert.equal(summary.failed, 1);
    assert.equal(summary.gate_blocked, 1, 'the second candidate still ran');
    assert.equal(summary.outcomes[0]?.status, 'failed');
    assert.match(summary.outcomes[0]?.detail ?? '', /Invalid URL/i);
    assert.equal(summary.outcomes[1]?.status, 'gate_blocked');
    assert.deepEqual(updates, ['loopback=gate_blocked'], 'a failed candidate keeps status=new');
  });
});

describe('a datastore failure stops the run', () => {
  it('rethrows rather than crawling the rest of the queue for nothing', async () => {
    const { client } = stubClient({ updateError: 'connection reset' });
    await assert.rejects(
      () =>
        runVerifyBatch({
          client,
          queue: [LOOPBACK, LOOPBACK],
          budgetMs: 10 * 60_000,
          log: () => {},
          warn: () => {},
        }),
      (error: unknown) => error instanceof DatastoreError && /connection reset/.test((error as Error).message),
    );
  });
});

describe('the run budget', () => {
  it('leaves the queue untouched when there is no room for even one candidate', async () => {
    const { client, updates } = stubClient();
    const summary = await runVerifyBatch({
      client,
      queue: [LOOPBACK, LOOPBACK, LOOPBACK],
      budgetMs: 1,
      log: () => {},
      warn: () => {},
    });
    assert.equal(summary.unreached, 3);
    assert.equal(summary.outcomes.length, 0);
    assert.deepEqual(updates, [], 'unreached candidates keep status=new and are ranked again tomorrow');
  });
});

describe('what the crawl says a candidate now is', () => {
  const decision = (allowed: boolean, llmIngest?: boolean) =>
    ({
      decision: {
        allowed,
        use_rights: llmIngest === undefined ? null : { llm_ingest: llmIngest },
      },
      evidence: {},
    }) as unknown as Parameters<typeof classify>[0][number];

  it('is gate_blocked when the landing page was refused', () => {
    assert.equal(classify([decision(false)]), 'gate_blocked');
    assert.equal(classify([]), 'gate_blocked');
  });

  it('is not_evaluable when we may fetch but not ingest (R2 §3.2)', () => {
    assert.equal(classify([decision(true, false)]), 'not_evaluable');
  });

  it('is crawled otherwise, including when the gate stated no USE lattice', () => {
    assert.equal(classify([decision(true, true)]), 'crawled');
    assert.equal(classify([decision(true)]), 'crawled');
  });
});
