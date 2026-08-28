/**
 * The database side of scoring: read a crawl generation, write the verdicts,
 * read back what selection needs.
 *
 * The connection itself is W2's `getPool()` (finds/sources/db.ts, merged),
 * imported rather than reimplemented -- one place in the pipeline decides what
 * happens when DATABASE_URL is absent, and it already fails loud per D6.
 *
 * Two rules this file exists to hold:
 *
 *   ONE TRANSACTION, ONE CLIENT. buildVerdictWrite() emits a plan beginning
 *   with BEGIN and ending with COMMIT. Run over a Pool, each statement could
 *   land on a different connection and the deferred D7 trigger would fire
 *   against an empty transaction -- the check would pass while the citations
 *   went somewhere else entirely. So the plan is pinned to one checked-out
 *   client, and a failure rolls back before the client is released.
 *
 *   THE NEVER-TWICE RULE LIVES IN ONE PLACE. Selection reads from
 *   `finds_undigested_candidates`, never from finds_candidates with a
 *   hand-rolled NOT EXISTS. That view excludes a candidate only once it is in
 *   a SENT digest, so a failed send does not burn finds Nikhil never saw.
 */

import type { Pool } from 'pg';
import type { CandidateStatus, Criterion, EvidenceRow, VerdictScore } from '../types.ts';
import type { SqlStatement } from './persist.ts';
import type { SelectionCandidate } from './select.ts';
import { c1StatusFromScore } from './c1.ts';

export { getPool } from '../sources/db.ts';

/** The most recent crawl generation for a candidate, or null if never crawled. */
export async function latestGeneration(pool: Pool, candidateId: string): Promise<string | null> {
  const { rows } = await pool.query<{ crawl_run_id: string }>(
    `SELECT crawl_run_id FROM finds_evidence
      WHERE candidate_id = $1
      ORDER BY fetched_at DESC, created_at DESC
      LIMIT 1`,
    [candidateId],
  );
  return rows[0]?.crawl_run_id ?? null;
}

/** Every evidence row of one generation. JSONB arrives already parsed. */
export async function loadGeneration(
  pool: Pool,
  candidateId: string,
  crawlRunId: string,
): Promise<EvidenceRow[]> {
  const { rows } = await pool.query<EvidenceRow>(
    `SELECT id, candidate_id, crawl_verdict_id, crawl_run_id, url, page_role, http_status,
            content_type, content_sha256, fetched_at, claims, quotes, observations, created_at
       FROM finds_evidence
      WHERE candidate_id = $1 AND crawl_run_id = $2
      ORDER BY url, id`,
    [candidateId, crawlRunId],
  );
  return rows;
}

/**
 * How many URLs the gate refused for this candidate.
 *
 * Not derivable from evidence: finds_evidence's composite FK pins the crawl
 * verdict to allowed=true, so a refusal leaves no evidence row at all. Without
 * this number a rationale cannot tell "unsubstantiated after eight pages" from
 * "unsubstantiated after one".
 */
export async function refusedUrlCount(pool: Pool, candidateId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM finds_crawl_verdicts
      WHERE candidate_id = $1 AND allowed = false`,
    [candidateId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Run a statement plan as one transaction on one connection.
 *
 * The plan carries its own BEGIN and COMMIT because the deferred D7 trigger
 * only means anything if the COMMIT is the same COMMIT. On failure we roll
 * back explicitly rather than relying on the client being discarded: a pooled
 * connection returned mid-transaction poisons whoever picks it up next.
 */
export async function runPlan(pool: Pool, plan: readonly SqlStatement[]): Promise<void> {
  const client = await pool.connect();
  try {
    for (const statement of plan) {
      await client.query(statement.text, statement.values);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Candidates whose evidence has been collected and not yet scored. */
export async function candidatesToScore(
  pool: Pool,
  status: CandidateStatus = 'crawled',
  limit = 500,
): Promise<{ id: string; status: CandidateStatus }[]> {
  const { rows } = await pool.query<{ id: string; status: CandidateStatus }>(
    `SELECT id, status FROM finds_candidates
      WHERE status = $1
      ORDER BY first_seen_at
      LIMIT $2`,
    [status, limit],
  );
  return rows;
}

/** The work-queue marker only. The verdict rows are the record of what happened. */
export async function markStatus(pool: Pool, candidateId: string, status: CandidateStatus): Promise<void> {
  await pool.query('UPDATE finds_candidates SET status = $2 WHERE id = $1', [candidateId, status]);
}

interface SelectionRow {
  id: string;
  name: string;
  tagline: string | null;
  product_url: string;
  first_seen_at: string;
  evidence_run_id: string;
  scores: Record<string, number>;
  source_slugs: string[];
}

/**
 * Everything selection needs, for candidates not already in a SENT digest.
 *
 * `DISTINCT ON` takes each candidate's most recently scored generation, so a
 * re-crawled product is judged on its current evidence rather than on a mix of
 * generations. Scores arrive as a criterion->score object; a criterion that was
 * unscoreable is simply absent, which is what makes selection able to set the
 * candidate aside rather than rank it as though it had lost.
 */
export async function loadSelectionCandidates(pool: Pool): Promise<SelectionCandidate[]> {
  const { rows } = await pool.query<SelectionRow>(
    `WITH latest AS (
        SELECT DISTINCT ON (candidate_id) candidate_id, evidence_run_id
          FROM finds_verdicts
         ORDER BY candidate_id, created_at DESC
     )
     SELECT c.id, c.name, c.tagline, c.product_url, c.first_seen_at,
            l.evidence_run_id,
            jsonb_object_agg(v.criterion, v.score) AS scores,
            COALESCE(
              (SELECT array_agg(DISTINCT s.slug)
                 FROM finds_candidate_sightings sg
                 JOIN finds_sources s ON s.id = sg.source_id
                WHERE sg.candidate_id = c.id),
              ARRAY[]::text[]
            ) AS source_slugs
       FROM finds_undigested_candidates c
       JOIN latest l ON l.candidate_id = c.id
       JOIN finds_verdicts v
         ON v.candidate_id = c.id AND v.evidence_run_id = l.evidence_run_id
      GROUP BY c.id, c.name, c.tagline, c.product_url, c.first_seen_at, l.evidence_run_id`,
  );

  return rows.map((row) => {
    const scores: Partial<Record<Criterion, VerdictScore>> = {};
    for (const [criterion, score] of Object.entries(row.scores)) {
      scores[criterion as Criterion] = score as VerdictScore;
    }
    return {
      candidate_id: row.id,
      name: row.name,
      tagline: row.tagline,
      product_url: row.product_url,
      evidence_run_id: row.evidence_run_id,
      source_slugs: row.source_slugs,
      scores,
      // Not a stored column: the C1 score and its status are 1:1 by
      // construction, so this is the exact inverse rather than a guess.
      c1_status: scores.C1 === undefined ? undefined : c1StatusFromScore(scores.C1),
      first_seen_at: new Date(row.first_seen_at).toISOString(),
    };
  });
}
