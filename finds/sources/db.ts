import { Pool } from 'pg';

// The one place ingest code touches a Postgres connection string.
//
// D0: the pipeline runs as a GitHub Actions cron against Supabase Postgres.
// A cron job is a backend batch process, not a browser client, so it talks
// directly to Postgres (bypassing RLS as the service role / a role with
// equivalent rights) rather than through PostgREST with the anon key that
// src/lib/supabase.ts uses. That also lets the exact same code run against
// the throwaway cluster finds/db/test-schema.sh spins up for local testing,
// which has no PostgREST in front of it at all.
//
// D6 pattern, matching finds/email/transport.ts: an absent credential is a
// loud, explicit failure, never a silent no-op.

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Cannot reach Postgres: DATABASE_URL is not set. ' +
        'This is a hard stop, not a skip -- set it to a Postgres connection ' +
        'string (the Supabase project connection string, or a local test ' +
        'cluster from finds/db/test-schema.sh) and re-run.',
    );
  }
  pool = new Pool({ connectionString });
  return pool;
}
