import type { SupabaseClient } from '@supabase/supabase-js';
import type { NewCandidate, NewCandidateSighting } from '../types.ts';

// The two-step upsert every connector goes through, exactly as specified in
// DEPENDENCIES.md's finds_candidates SHAPES READY note: on a repeat sighting
// of an already-known product, ONLY last_seen_at changes -- name/tagline/
// product_url stay exactly as the first source reported them (W3 tested
// this: "three URL spellings from three platforms collapse to ONE candidate
// row"). canonical_url is a GENERATED column -- never write it here.
//
// PostgREST's own upsert can only express "overwrite every submitted column
// on conflict," which would let a later source silently rewrite an earlier
// source's name/tagline -- not what the two-step SQL upsert DEPENDENCIES.md
// specifies does. So upsertCandidate reproduces it as three REST calls
// instead of one SQL statement: look up the row by the same generated key
// Postgres would use (via the already-deployed finds_normalize_url RPC),
// then UPDATE last_seen_at only if it exists, INSERT only if it does not.
// The 23505 catch handles the race where two connectors insert the same new
// product concurrently.

function fail(action: string, message: string): never {
  throw new Error(`${action} failed: ${message}`);
}

/**
 * Upserts the product. Returns the candidate id whether this call created
 * the row or found an existing one via canonical_url.
 */
export async function upsertCandidate(client: SupabaseClient, input: NewCandidate): Promise<string> {
  const { data: canonicalUrl, error: rpcError } = await client.rpc('finds_normalize_url', {
    raw: input.product_url,
  });
  if (rpcError) fail('finds_normalize_url RPC', rpcError.message);

  const { data: existing, error: selectError } = await client
    .from('finds_candidates')
    .select('id')
    .eq('canonical_url', canonicalUrl as string)
    .maybeSingle();
  if (selectError) fail('finds_candidates lookup', selectError.message);

  if (existing) {
    const { error: updateError } = await client
      .from('finds_candidates')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id);
    if (updateError) fail('finds_candidates last_seen_at update', updateError.message);
    return (existing as { id: string }).id;
  }

  const { data: inserted, error: insertError } = await client
    .from('finds_candidates')
    .insert({ product_url: input.product_url, name: input.name, tagline: input.tagline ?? null })
    .select('id')
    .single();
  if (insertError) {
    // Unique-violation on canonical_url: another connector inserted the same
    // product between our lookup and this insert. Re-read rather than fail.
    if (insertError.code === '23505') {
      const { data: raced, error: raceError } = await client
        .from('finds_candidates')
        .select('id')
        .eq('canonical_url', canonicalUrl as string)
        .single();
      if (raceError) fail('finds_candidates insert-race re-lookup', raceError.message);
      return (raced as { id: string }).id;
    }
    fail('finds_candidates insert', insertError.message);
  }
  return (inserted as { id: string }).id;
}

/**
 * Upserts one platform listing for a candidate. Returns true if this call
 * inserted a new sighting, false if it already existed (`ignoreDuplicates`
 * maps to `ON CONFLICT (source_id, external_id) DO NOTHING`) -- callers use
 * this to report only genuinely new rows.
 */
export async function upsertSighting(client: SupabaseClient, input: NewCandidateSighting): Promise<boolean> {
  const { data, error } = await client
    .from('finds_candidate_sightings')
    .upsert(
      {
        candidate_id: input.candidate_id,
        source_id: input.source_id,
        external_id: input.external_id,
        source_url: input.source_url,
        title: input.title ?? null,
        author_handle: input.author_handle ?? null,
        posted_at: input.posted_at ?? null,
        raw: input.raw ?? {},
      },
      { onConflict: 'source_id,external_id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) fail('finds_candidate_sightings upsert', error.message);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/**
 * Which of `externalIds` already have a sighting for this source. Exists for
 * sources where fetching one item's full record costs a separate expensive
 * request (Peerlist's per-project detail-page hop, rate-limited by
 * Cloudflare) -- callers use this to skip re-resolving what is already
 * stored instead of discovering that via a failed insert.
 */
export async function getSeenExternalIds(
  client: SupabaseClient,
  sourceId: string,
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const { data, error } = await client
    .from('finds_candidate_sightings')
    .select('external_id')
    .eq('source_id', sourceId)
    .in('external_id', externalIds);
  if (error) fail('finds_candidate_sightings seen-lookup', error.message);
  return new Set((data as { external_id: string }[]).map((row) => row.external_id));
}
