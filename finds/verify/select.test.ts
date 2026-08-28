/**
 * The queue order, which is the one real policy decision in the batch runner.
 *
 * No datastore: the client is a stub that returns rows the test wrote, so what
 * is under test is the ranking and the distinct-source counting, not Supabase.
 * The rows are invented shapes, built inline and thrown away -- D6 bans a
 * committed fixture, not a test that constructs one.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectQueue } from './select.ts';
import { DatastoreError } from './persist.ts';

type Row = Record<string, unknown>;

/**
 * The smallest thing that answers the two queries selectQueue makes. Every
 * builder method returns `this`, and awaiting it yields whatever the table was
 * seeded with -- which is exactly the shape postgrest-js presents.
 */
function stubClient(tables: Record<string, Row[] | { error: string }>): SupabaseClient {
  return {
    from(table: string) {
      const seeded = tables[table];
      const result =
        seeded && 'error' in seeded && !Array.isArray(seeded)
          ? { data: null, error: { message: seeded.error } }
          : { data: seeded ?? [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const method of ['select', 'eq', 'order', 'limit', 'in']) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

const CANDIDATES: Row[] = [
  { id: 'a', product_url: 'https://a.test/', name: 'One source, newest', first_seen_at: '2026-08-28T12:00:00Z' },
  { id: 'b', product_url: 'https://b.test/', name: 'Three sources, older', first_seen_at: '2026-08-27T09:00:00Z' },
  { id: 'c', product_url: 'https://c.test/', name: 'Two sources', first_seen_at: '2026-08-28T08:00:00Z' },
  { id: 'd', product_url: 'https://d.test/', name: 'No sightings at all', first_seen_at: '2026-08-28T11:00:00Z' },
];

const SIGHTINGS: Row[] = [
  { candidate_id: 'a', source_id: 's1' },
  { candidate_id: 'b', source_id: 's1' },
  { candidate_id: 'b', source_id: 's2' },
  { candidate_id: 'b', source_id: 's3' },
  { candidate_id: 'c', source_id: 's2' },
  { candidate_id: 'c', source_id: 's4' },
  // s2 listed 'c' twice. Two rows, still ONE source.
  { candidate_id: 'c', source_id: 's2' },
];

describe('the daily queue order', () => {
  it('ranks by how many independent sources reported it, then newest first', async () => {
    const queue = await selectQueue(stubClient({ finds_candidates: CANDIDATES, finds_candidate_sightings: SIGHTINGS }), 10);
    assert.deepEqual(
      queue.map((c) => `${c.id}:${c.sightings}`),
      ['b:3', 'c:2', 'a:1', 'd:0'],
      'three platforms beats one, and a same-day launch beats yesterday only at equal counts',
    );
  });

  it('counts distinct sources, not sighting rows', async () => {
    const queue = await selectQueue(stubClient({ finds_candidates: CANDIDATES, finds_candidate_sightings: SIGHTINGS }), 10);
    const c = queue.find((row) => row.id === 'c');
    assert.equal(c?.sightings, 2, 'one platform reposting must not outrank two platforms agreeing');
  });

  it('cuts the queue at the run cap, keeping the best', async () => {
    const queue = await selectQueue(stubClient({ finds_candidates: CANDIDATES, finds_candidate_sightings: SIGHTINGS }), 2);
    assert.deepEqual(queue.map((c) => c.id), ['b', 'c']);
  });

  it('returns nothing when no candidate has status=new', async () => {
    const queue = await selectQueue(stubClient({ finds_candidates: [], finds_candidate_sightings: [] }), 10);
    assert.deepEqual(queue, []);
  });

  it('raises a DatastoreError, not a plain one, so the runner aborts', async () => {
    await assert.rejects(
      () => selectQueue(stubClient({ finds_candidates: { error: 'connection refused' } }), 10),
      (error: unknown) => error instanceof DatastoreError && /connection refused/.test((error as Error).message),
    );
  });
});
