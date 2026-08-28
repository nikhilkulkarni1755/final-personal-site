import type { SupabaseClient } from '@supabase/supabase-js';
import type { SourceDefinition } from './connector.ts';

// The D3 write path: every pull attempt records its own outcome in
// finds_sources, so a dead source is reported as DOWN rather than silently
// absorbed into "found nothing today" (DEPENDENCIES.md, finds_sources SHAPES
// READY note). Status itself is read from finds_source_health, computed
// there -- this module only ever writes the raw columns, never the status.

function fail(action: string, message: string): never {
  throw new Error(`finds_sources ${action} failed: ${message}`);
}

/**
 * Registers a source if it does not exist yet, or refreshes its display
 * fields if it does. finds_sources ships with no seed rows (D6); a connector
 * registers itself the first time it runs, against a credential that
 * actually exists (or none, for an anonymous source).
 */
export async function ensureSource(client: SupabaseClient, def: SourceDefinition): Promise<string> {
  const { data, error } = await client
    .from('finds_sources')
    .upsert(
      {
        slug: def.slug,
        display_name: def.displayName,
        homepage_url: def.homepageUrl,
        auth_kind: def.authKind,
        staleness_budget_hours: def.stalenessBudgetHours ?? 36,
      },
      { onConflict: 'slug' },
    )
    .select('id')
    .single();
  if (error) fail('upsert', error.message);
  return (data as { id: string }).id;
}

/** Call once a pull completes and returned a usable response. */
export async function recordSuccess(client: SupabaseClient, sourceId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from('finds_sources')
    .update({ last_attempt_at: now, last_success_at: now, consecutive_failures: 0 })
    .eq('id', sourceId);
  if (error) fail('recordSuccess', error.message);
}

/**
 * Call once a pull fails. `message` is a verbatim failure reason -- never a
 * credential (finds_sources.last_error COMMENT). `last_error`/`last_error_at`
 * are set together: a CHECK constraint enforces the pair.
 */
export async function recordFailure(client: SupabaseClient, sourceId: string, message: string): Promise<void> {
  const { data: current, error: selectError } = await client
    .from('finds_sources')
    .select('consecutive_failures')
    .eq('id', sourceId)
    .single();
  if (selectError) fail('recordFailure (read)', selectError.message);

  const now = new Date().toISOString();
  const { error } = await client
    .from('finds_sources')
    .update({
      last_attempt_at: now,
      last_error: message,
      last_error_at: now,
      consecutive_failures: (current as { consecutive_failures: number }).consecutive_failures + 1,
    })
    .eq('id', sourceId);
  if (error) fail('recordFailure (write)', error.message);
}
