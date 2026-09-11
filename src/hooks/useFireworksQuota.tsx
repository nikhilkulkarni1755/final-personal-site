import { useCallback, useEffect, useState } from 'react';

/**
 * useFireworksQuota - how many prompts this address has left.
 *
 * The count is keyed on the IP the gateway sees, which the browser cannot
 * forge, and enforced by a trigger in Supabase that refuses the fourth insert.
 * This hook only ever *reads* the number; the gateway writes it, before any
 * inference happens. There is no client-side path to the table at all.
 *
 * Two limits come back: this address's remaining inputs and the global daily
 * budget. Either at zero closes the box, and so does a failure to read them --
 * a quota that opens up when it cannot be checked is not a quota. Alongside
 * them, what the backend looks like right now: whether a GPU is free at all,
 * and how long the engine stays warm from the last run.
 */

const GATEWAY = (import.meta.env.VITE_FIREWORKS_GATEWAY as string | undefined) ?? '';

interface QuotaState {
  used: number;
  remaining: number;
  limit: number;
  dailyRemaining: number;
  turnCap: number;
  /** RunPod's worker states for the endpoint, or null when unreadable. */
  workers: Record<string, number> | null;
  /** Every worker slot is throttled: a run would wait ten minutes for nothing. */
  noGpu: boolean;
  /** Epoch ms until which the engine stays warm from the last run, or null. */
  warmUntil: number | null;
  /** The same, as seconds left at the moment of the last refresh. */
  warmFor: number;
  loading: boolean;
  /** True when the count could not be read, so the box stays closed. */
  unavailable: boolean;
}

export const useFireworksQuota = () => {
  const [state, setState] = useState<QuotaState>({
    used: 0,
    remaining: 0,
    limit: 3,
    dailyRemaining: 0,
    turnCap: 12,
    workers: null,
    noGpu: false,
    warmUntil: null,
    warmFor: 0,
    loading: true,
    unavailable: false,
  });

  const refresh = useCallback(async () => {
    if (!GATEWAY) return;
    try {
      const response = await fetch(`${GATEWAY}/quota`);
      if (!response.ok) throw new Error(String(response.status));
      const quota = (await response.json()) as Omit<QuotaState, 'loading' | 'unavailable' | 'warmFor'>;
      const warmFor = quota.warmUntil ? Math.max(0, Math.round((quota.warmUntil - Date.now()) / 1000)) : 0;
      setState({ ...quota, warmFor, loading: false, unavailable: false });
    } catch {
      setState((current) => ({ ...current, remaining: 0, dailyRemaining: 0, loading: false, unavailable: true }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
};

export default useFireworksQuota;
