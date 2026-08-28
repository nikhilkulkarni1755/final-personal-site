/**
 * A proof harness, not an entry point.
 *
 * cli.ts reaches the database through supabase-js (D17), which needs a live
 * PostgREST -- and the throwaway Postgres cluster prove-publish.sh spins up has
 * none. So this reads the same rows on stdin as JSON and writes the row it
 * would insert to stdout, letting the proof drive the REAL snapshot code with
 * psql on both ends. Same pattern as finds/score/offline.ts.
 *
 * What that proves: this lane's rules execute (Node's type stripping accepts
 * them, which `tsc --noEmit` does not establish -- see W8's finding), against
 * rows that came out of a real Postgres, and the row they produce is accepted
 * by the real finds_published table with its real CHECKs and its real RLS.
 *
 * What it does NOT prove: db.ts's supabase-js binding. That needs a live
 * Supabase project, and no lane in this initiative can prove it here.
 *
 *   {"source": PublishSource, "options": PublishOptions}  ->  {"row"} | {"refusals"}
 */

import { buildSnapshot } from './snapshot.ts';
import type { PublishOptions } from './snapshot.ts';
import type { PublishSource } from './types.ts';

const input = JSON.parse(await new Response(process.stdin).text()) as {
  source: PublishSource;
  options: PublishOptions;
};

try {
  const result = buildSnapshot(input.source, input.options);
  console.log(JSON.stringify(result.ok ? { row: result.row, notes: result.notes } : result));
} catch (error) {
  // An approval failure is a throw, not a refusal -- surface it as itself.
  console.log(JSON.stringify({ refused_outright: (error as Error).message }));
}
