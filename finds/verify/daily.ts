/**
 * The verify stage of the daily run: crawl the day's new candidates through
 * the gate and record what we found.
 *
 *   node finds/verify/daily.ts          (npm run verify:daily)
 *
 * env  SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (D17/D19)
 *      FINDS_VERIFY_MAX_CANDIDATES   default 40
 *      FINDS_VERIFY_BUDGET_MS        default 45 minutes
 *      FINDS_VERIFY_OUT              write the run summary here (optional)
 *
 * Composition only. The loop and its failure policy are in batch.ts, the queue
 * order is in select.ts, and the crawl is crawl.ts -- this file is environment,
 * credential and exit code.
 *
 * WHY THERE IS A BUDGET: see select.ts. W2's connectors land on the order of
 * 130 new candidates a day; at R2 §5.3's caps that is between two and eleven
 * hours of crawling. A daily job gets a fraction of that, so the run takes a
 * bounded, ranked prefix and says out loud what it did not reach.
 */

import { writeFileSync } from 'node:fs';
import { getSupabaseClient } from '../sources/db.ts';
import { runVerifyBatch } from './batch.ts';
import { selectQueue } from './select.ts';

const MAX_CANDIDATES = Number(process.env.FINDS_VERIFY_MAX_CANDIDATES ?? 40);
const BUDGET_MS = Number(process.env.FINDS_VERIFY_BUDGET_MS ?? 45 * 60_000);
const OUT = process.env.FINDS_VERIFY_OUT?.trim();

// Throws its own loud message when the credential is absent (D6/D17). Before
// any crawling: there is no point putting load on somebody's site when we have
// nowhere to record what we found.
const client = getSupabaseClient();

const queue = await selectQueue(client, MAX_CANDIDATES);
if (queue.length === 0) {
  console.log('[verify] no candidates with status=new. Nothing to crawl.');
}
console.log(
  `[verify] ${queue.length} candidate(s) queued, cap ${MAX_CANDIDATES}, ` +
    `budget ${Math.round(BUDGET_MS / 60_000)} min`,
);

let summary;
try {
  summary = await runVerifyBatch({ client, queue, budgetMs: BUDGET_MS });
} catch (cause) {
  console.error(`[verify] ABORTING: the datastore failed: ${cause instanceof Error ? cause.message : cause}`);
  console.error(
    '[verify] Continuing would crawl the rest of the queue and throw every row away. ' +
      'Candidates not yet updated keep status=new and are picked up on the next run.',
  );
  process.exit(1);
}

if (OUT) writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  `[verify] ${summary.crawled} crawled, ${summary.gate_blocked} gate-blocked, ` +
    `${summary.not_evaluable} not-evaluable, ${summary.failed} failed, ` +
    `${summary.unreached} unreached in ${Math.round(summary.elapsed_ms / 1000)}s`,
);

// Gate-blocked and not-evaluable are the gate WORKING, not the run failing:
// R2 §10.3 measured 19-23% of launches declining agent access, so a day with
// several of them is the product behaving as designed (D12). A queue where not
// one candidate produced any verdict at all is something else.
if (queue.length > 0 && summary.crawled + summary.gate_blocked + summary.not_evaluable === 0) {
  console.error(
    `[verify] FAILED: ${queue.length} candidate(s) queued and not one produced a verdict. ` +
      'That is not a quiet day, it is a broken crawler.',
  );
  process.exit(1);
}
