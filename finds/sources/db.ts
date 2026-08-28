import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The one place ingest code touches a Supabase credential.
//
// D17 (coordinator): every lane that needs privileged DB access reads
// SUPABASE_URL (falling back to VITE_SUPABASE_URL, the same value the
// browser client in src/lib/supabase.ts uses) and SUPABASE_SERVICE_ROLE_KEY.
// The service-role key bypasses RLS -- it must never carry a VITE_ prefix,
// or Vite would bundle a full RLS bypass into the site the browser loads.
// This module never reads a VITE_-prefixed name for the key, only for the
// URL fallback.
//
// D6 pattern, matching finds/email/transport.ts: an absent credential is a
// loud, explicit failure, never a silent no-op.

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Cannot reach Supabase: SUPABASE_URL (or VITE_SUPABASE_URL) and/or ' +
        'SUPABASE_SERVICE_ROLE_KEY are not set. This is a hard stop, not a ' +
        'skip -- set both and re-run.',
    );
  }
  client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return client;
}
