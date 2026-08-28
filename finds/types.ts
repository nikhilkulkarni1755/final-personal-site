/**
 * Shared types for the Interesting Finds pipeline.
 *
 * This module is the single contract between lanes: ingest (W2), the crawler
 * (W4), scoring (W5), the digest (W6) and the site page (W7) all speak these
 * shapes. W3 owns the file; other lanes propose changes through the
 * coordinator. Every type here mirrors a table in supabase/migrations, and the
 * migration is the authority -- if the two disagree, the SQL is right.
 *
 * Convention: `Row` types are what the database hands back (timestamps are ISO
 * strings, as PostgREST returns them). `New*` types are what a writer supplies,
 * omitting anything the database fills in.
 */

/** ISO 8601 timestamp string, as PostgREST serialises TIMESTAMPTZ. */
export type Timestamp = string;

/* ========================================================================== */
/* sources                                                                     */
/* ========================================================================== */

/**
 * How we authenticate to a source. `session_cookie` is credential replay and
 * is expected to expire -- see DECISIONS D3.
 */
export type SourceAuthKind =
  | 'none'
  | 'public_api'
  | 'api_key'
  | 'oauth'
  | 'session_cookie';

/**
 * Computed source status. The point of `down` is that it is distinguishable
 * from "found nothing today": an expired Peerlist cookie must be reported, not
 * absorbed into an empty result.
 */
export type SourceStatus = 'ok' | 'stale' | 'down' | 'disabled';

/** A row of `finds_sources`. Private: readable only with the service role. */
export interface SourceRow {
  id: string;
  slug: string;
  display_name: string;
  homepage_url: string;
  enabled: boolean;
  auth_kind: SourceAuthKind;
  /** Known expiry of the credential. `null` means unknown, never means valid. */
  credential_expires_at: Timestamp | null;
  last_attempt_at: Timestamp | null;
  last_success_at: Timestamp | null;
  /** Verbatim failure reason. Never a credential. */
  last_error: string | null;
  last_error_at: Timestamp | null;
  consecutive_failures: number;
  /** No success inside this window makes the source `stale`. */
  staleness_budget_hours: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type NewSource = Pick<SourceRow, 'slug' | 'display_name' | 'homepage_url'> &
  Partial<Pick<SourceRow, 'enabled' | 'auth_kind' | 'credential_expires_at' | 'staleness_budget_hours'>>;

/** A row of the `finds_source_health` view. */
export interface SourceHealthRow {
  id: string;
  slug: string;
  display_name: string;
  status: SourceStatus;
  last_success_at: Timestamp | null;
  last_attempt_at: Timestamp | null;
  last_error: string | null;
  last_error_at: Timestamp | null;
  consecutive_failures: number;
  credential_expires_at: Timestamp | null;
}
