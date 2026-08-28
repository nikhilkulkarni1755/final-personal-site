/**
 * A proof harness, not a pipeline entry point.
 *
 * `run.ts` reaches the database through supabase-js (D17), which needs a live
 * PostgREST -- and the throwaway Postgres cluster the proofs spin up has none.
 * So this reads the same rows on stdin as JSON and writes its answers to
 * stdout, letting prove-pipeline.sh drive the REAL scoring, write-building,
 * selection and digest code with psql on both ends.
 *
 * What that proves: this lane's code executes (Node's type stripping accepts
 * it, which `tsc --noEmit` does not establish -- see W8's finding), on rows
 * that came out of a real Postgres, and the payload it produces is accepted by
 * the real finds_write_verdict function.
 *
 * What it does NOT prove: db.ts's supabase-js binding. That needs a live
 * Supabase project, and no lane can prove it here.
 *
 *   score:  {"candidate_id","candidate_status","evidence_run_id","rows",...} -> RPC payload
 *   select: {"date","candidates":[...]}                        -> {selection, digest}
 */

import { buildVerdictWrite } from './persist.ts';
import { scoreCandidate } from './score.ts';
import type { ScoreInput } from './score.ts';
import { selectForDay } from './select.ts';
import type { SelectionCandidate } from './select.ts';
import { toDigestInput } from './digest.ts';

const mode = process.argv[2];
const input = JSON.parse(await new Response(process.stdin).text()) as unknown;

if (mode === 'score') {
  const outcome = scoreCandidate(input as ScoreInput);
  if (outcome.kind === 'unscoreable') {
    console.log(JSON.stringify({ unscoreable: outcome.reason, detail: outcome.detail }));
  } else {
    console.log(
      JSON.stringify({
        payload: buildVerdictWrite(outcome.candidate_id, outcome.evidence_run_id, outcome.scores),
      }),
    );
  }
} else if (mode === 'select') {
  const { date, candidates } = input as { date: string; candidates: SelectionCandidate[] };
  const selection = selectForDay(date, candidates);
  console.log(JSON.stringify({ selection, digest: toDigestInput(selection) }));
} else {
  console.error('usage: node finds/score/offline.ts score|select  < input.json');
  process.exit(2);
}
