import type { Pool } from 'pg';
import type { SourceDefinition } from './connector.ts';

// The D3 write path: every pull attempt records its own outcome in
// finds_sources, so a dead source is reported as DOWN rather than silently
// absorbed into "found nothing today" (DEPENDENCIES.md, finds_sources SHAPES
// READY note). Status itself is read from finds_source_health, computed
// there -- this module only ever writes the raw columns, never the status.

/**
 * Registers a source if it does not exist yet, or refreshes its display
 * fields if it does. finds_sources ships with no seed rows (D6); a connector
 * registers itself the first time it runs, against a credential that
 * actually exists (or none, for an anonymous source).
 */
export async function ensureSource(pool: Pool, def: SourceDefinition): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO finds_sources (slug, display_name, homepage_url, auth_kind, staleness_budget_hours)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           homepage_url = EXCLUDED.homepage_url
     RETURNING id`,
    [def.slug, def.displayName, def.homepageUrl, def.authKind, def.stalenessBudgetHours ?? 36],
  );
  return rows[0].id;
}

/** Call once a pull completes and returned a usable response. */
export async function recordSuccess(pool: Pool, sourceId: string): Promise<void> {
  await pool.query(
    `UPDATE finds_sources
        SET last_attempt_at = NOW(),
            last_success_at = NOW(),
            consecutive_failures = 0
      WHERE id = $1`,
    [sourceId],
  );
}

/**
 * Call once a pull fails. `message` is a verbatim failure reason -- never a
 * credential (finds_sources.last_error COMMENT). `last_error`/`last_error_at`
 * are set together: a CHECK constraint enforces the pair.
 */
export async function recordFailure(pool: Pool, sourceId: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE finds_sources
        SET last_attempt_at = NOW(),
            last_error = $2,
            last_error_at = NOW(),
            consecutive_failures = consecutive_failures + 1
      WHERE id = $1`,
    [sourceId, message],
  );
}
