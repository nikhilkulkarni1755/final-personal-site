import type { Pool } from 'pg';
import type { NewCandidate, NewCandidateSighting } from '../types.ts';

// The two-step upsert every connector goes through, exactly as specified in
// DEPENDENCIES.md's finds_candidates SHAPES READY note. Both steps are
// idempotent by construction: re-running a pull collapses onto the same
// candidate (canonical_url is GENERATED -- never write it here) and inserts
// no duplicate sighting (source_id, external_id) is UNIQUE).

/**
 * Upserts the product. Returns the candidate id whether this call created
 * the row or found an existing one via canonical_url.
 */
export async function upsertCandidate(pool: Pool, input: NewCandidate): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO finds_candidates (product_url, name, tagline)
     VALUES ($1, $2, $3)
     ON CONFLICT (canonical_url) DO UPDATE SET last_seen_at = NOW()
     RETURNING id`,
    [input.product_url, input.name, input.tagline ?? null],
  );
  return rows[0].id;
}

/**
 * Upserts one platform listing for a candidate. Returns true if this call
 * inserted a new sighting, false if it already existed (ON CONFLICT DO
 * NOTHING) -- callers use this to report only genuinely new rows.
 */
export async function upsertSighting(
  pool: Pool,
  input: NewCandidateSighting,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO finds_candidate_sightings
       (candidate_id, source_id, external_id, source_url, title, author_handle, posted_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source_id, external_id) DO NOTHING`,
    [
      input.candidate_id,
      input.source_id,
      input.external_id,
      input.source_url,
      input.title ?? null,
      input.author_handle ?? null,
      input.posted_at ?? null,
      JSON.stringify(input.raw ?? {}),
    ],
  );
  return (rowCount ?? 0) > 0;
}
