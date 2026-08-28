/**
 * The verify stage's loop: crawl a queue of candidates, record each, keep going.
 *
 * Separate from daily.ts so that the policy below can be driven over real
 * launch sites without a datastore in the way. daily.ts is the CLI around it:
 * environment, credential, queue, exit code.
 *
 * FAILURE POLICY, which is the reason this is a module and not a for-loop:
 *
 *   one candidate fails   -> record it, keep going. A site that times out or
 *                            serves malformed HTML is a normal Tuesday, and
 *                            the other candidates should not pay for it (D3).
 *   the datastore fails   -> ABORT, by rethrowing. Carrying on would crawl the
 *                            rest of the queue and throw every row away: real
 *                            load on real people's servers in exchange for
 *                            nothing. That is the one failure that must stop
 *                            the run.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { crawlCandidate } from './crawl.ts';
import type { CrawlRecord } from './crawl.ts';
import { DatastoreError, persistCrawl } from './persist.ts';
import type { QueuedCandidate } from './select.ts';

export type CandidateStatusAfterCrawl = 'crawled' | 'gate_blocked' | 'not_evaluable';

export interface CandidateOutcome {
  candidate_id: string;
  product_url: string;
  status: CandidateStatusAfterCrawl | 'failed';
  crawl_run_id?: string;
  verdicts?: number;
  evidence?: number;
  detail?: string;
}

export interface BatchSummary {
  started_at: string;
  finished_at: string;
  elapsed_ms: number;
  queued: number;
  /** Candidates the budget did not reach. They keep status=new. */
  unreached: number;
  crawled: number;
  gate_blocked: number;
  not_evaluable: number;
  failed: number;
  outcomes: CandidateOutcome[];
}

/**
 * R2 §5.3's per-candidate wall clock. Less than this left on the run budget
 * means the next candidate cannot finish, and a crawl cut off halfway is worse
 * than one never started: load on someone's site for evidence we then have to
 * describe as incomplete.
 */
export const PER_CANDIDATE_WORST_CASE_MS = 300_000;

/**
 * What the crawl says this candidate now is, in W3's work-queue vocabulary.
 *
 * `gate_blocked` when the landing page itself was refused: there is no evidence
 * to score and never will be under that verdict. `not_evaluable` when the fetch
 * was allowed but `llm_ingest` is false -- R2 §3.2 says C1-C4 cannot be
 * evaluated at all, and D6 says that is a recorded non-evaluation, never an
 * invented low score. Two different facts, and the schema has a word for each.
 */
export function classify(records: readonly CrawlRecord[]): CandidateStatusAfterCrawl {
  const landing = records[0];
  if (!landing || !landing.decision.allowed) return 'gate_blocked';
  if (landing.decision.use_rights?.llm_ingest === false) return 'not_evaluable';
  return 'crawled';
}

export interface BatchOptions {
  client: SupabaseClient;
  queue: readonly QueuedCandidate[];
  /** Wall clock for the whole run, not per candidate. */
  budgetMs: number;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export async function runVerifyBatch(options: BatchOptions): Promise<BatchSummary> {
  const { client, queue, budgetMs } = options;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.error;

  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const outcomes: CandidateOutcome[] = [];
  let unreached = 0;

  for (const [index, candidate] of queue.entries()) {
    const remaining = deadline - Date.now();
    if (remaining < PER_CANDIDATE_WORST_CASE_MS) {
      unreached = queue.length - index;
      log(
        `[verify] stopping with ${unreached} candidate(s) unreached: ${Math.round(remaining / 1000)}s left, ` +
          `under the ${PER_CANDIDATE_WORST_CASE_MS / 1000}s one candidate may take. ` +
          `They keep status=new and are ranked again tomorrow.`,
      );
      break;
    }

    const label = `${index + 1}/${queue.length} ${candidate.name} <${candidate.product_url}>`;
    try {
      const result = await crawlCandidate({ candidateId: candidate.id, productUrl: candidate.product_url });
      const written = await persistCrawl(candidate.id, result, client);
      const status = classify(result.records);

      const { error } = await client
        .from('finds_candidates')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', candidate.id);
      // Nothing but this stage moves a candidate off 'new'. If the update
      // fails the row is re-crawled on every future run, so it is a datastore
      // failure and not a per-candidate one.
      if (error) throw new DatastoreError(`could not set ${candidate.id} to ${status}: ${error.message}`);

      outcomes.push({
        candidate_id: candidate.id,
        product_url: candidate.product_url,
        status,
        crawl_run_id: written.crawlRunId,
        verdicts: written.verdicts,
        evidence: written.evidence,
      });
      log(`[verify] ${label} -> ${status} (${written.verdicts} verdict(s), ${written.evidence} evidence row(s))`);
    } catch (cause) {
      if (cause instanceof DatastoreError) throw cause;
      const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      outcomes.push({ candidate_id: candidate.id, product_url: candidate.product_url, status: 'failed', detail });
      warn(`[verify] ${label} -> FAILED, continuing: ${detail}`);
    }
  }

  return {
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAt,
    queued: queue.length,
    unreached,
    crawled: outcomes.filter((o) => o.status === 'crawled').length,
    gate_blocked: outcomes.filter((o) => o.status === 'gate_blocked').length,
    not_evaluable: outcomes.filter((o) => o.status === 'not_evaluable').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    outcomes,
  };
}
