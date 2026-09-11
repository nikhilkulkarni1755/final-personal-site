import { useCallback, useEffect, useState } from 'react';

/**
 * useFireworksQuota - how many prompts this address has left.
 *
 * The count is keyed on the IP the gateway sees, which the browser cannot
 * forge, and enforced by a trigger in Supabase that refuses the fourth insert.
 * This hook only ever *reads* the number; the gateway writes it, before any
 * inference happens. There is no client-side path to the table at all.
 *
 * Two limits come back: this address's remaining prompts and the global daily
 * budget. Either at zero closes the box, and so does a failure to read them --
 * a quota that opens up when it cannot be checked is not a quota.
 */

const GATEWAY = (import.meta.env.VITE_FIREWORKS_GATEWAY as string | undefined) ?? '';

interface QuotaState {
  used: number;
  remaining: number;
  limit: number;
  dailyRemaining: number;
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
    loading: true,
    unavailable: false,
  });

  const refresh = useCallback(async () => {
    if (!GATEWAY) return;
    try {
      const response = await fetch(`${GATEWAY}/quota`);
      if (!response.ok) throw new Error(String(response.status));
      const quota = (await response.json()) as Pick<QuotaState, 'used' | 'remaining' | 'limit' | 'dailyRemaining'>;
      setState({ ...quota, loading: false, unavailable: false });
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
