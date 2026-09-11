import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * useFireworksRuns - the dataset the page is building, one row per run.
 *
 * Read from `fireworks_runs_public`, a view the gateway's rows are exposed
 * through: what was asked, what the model did, and every latency measured,
 * with the per-turn rows rolled up. No address hashes are in it; the base
 * tables stay closed to the browser. Refreshed after each run, so the row a
 * visitor just produced appears at the top of the table they are looking at.
 */

export interface RunRow {
  id: string;
  created_at: string;
  prompt: string;
  model: string | null;
  outcome: string;
  contract_outcome: string | null;
  paths: string[] | null;
  turns: number;
  wake_ms: number | null;
  ttft_ms: number | null;
  engine_boot_s: number | null;
  e2e_ms: number | null;
  mean_tpot_ms: number | null;
  mean_turn_ttft_ms: number | null;
  prompt_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
}

export const useFireworksRuns = () => {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      // The view is not in the generated types; it is read-only and public.
      (supabase as unknown as SupabaseClient)
        .from('fireworks_runs_public')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
        .then(({ data, error: err }) => {
          if (err) setError(err.message);
          else setRows((data ?? []) as RunRow[]);
        }),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, error, refresh };
};

export default useFireworksRuns;
