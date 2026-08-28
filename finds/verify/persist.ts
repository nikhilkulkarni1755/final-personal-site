/**
 * Writing a crawl pass into `finds_evidence`.
 *
 * The table is append-only and immutable, enforced by a trigger that refuses
 * UPDATE, DELETE and TRUNCATE for every caller including the service role. So
 * there is deliberately no update path here and no upsert: re-crawling appends
 * a new generation, identified by its own `crawl_run_id`, and the old
 * generation stays exactly as it was. A verdict records which generation it
 * scored, so overwriting would make every citation ambiguous.
 *
 * All rows of one pass go in a single insert. A half-written generation is
 * worse than none: W5 would score a crawl that never finished and have no way
 * to know.
 */

import { createClient } from '@supabase/supabase-js';
import type { NewEvidence } from './types.ts';

/**
 * Loud, explicit, non-zero. The pipeline writes with the service role, which
 * is the only key that can insert into a table anon and authenticated are
 * REVOKEd from. Never fall back to the anon key and never no-op quietly --
 * a crawl that silently persisted nothing looks identical to a candidate with
 * no evidence, which is the failure D6 exists to prevent.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. W4 cannot write evidence without it and will not pretend it did. ` +
        `finds_evidence REVOKEs anon and authenticated, so the service role is required.`,
    );
  }
  return value;
}

export interface PersistResult {
  crawlRunId: string;
  inserted: number;
}

export async function persistEvidence(rows: readonly NewEvidence[]): Promise<PersistResult> {
  if (rows.length === 0) {
    throw new Error('Refusing to record a crawl pass that produced no rows; even a refusal produces one.');
  }
  const runIds = new Set(rows.map((row) => row.crawl_run_id));
  if (runIds.size !== 1) {
    throw new Error(`One crawl pass is one crawl_run_id; got ${runIds.size}. Verdicts cite a generation, not a mixture.`);
  }

  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.from('finds_evidence').insert(rows as NewEvidence[]).select('id');
  if (error) {
    throw new Error(`finds_evidence insert failed: ${error.message}${error.hint ? ` (${error.hint})` : ''}`);
  }

  return { crawlRunId: [...runIds][0]!, inserted: data?.length ?? 0 };
}
