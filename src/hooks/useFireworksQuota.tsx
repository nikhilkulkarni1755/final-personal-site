import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getVisitorId } from '../lib/analytics-utils';

/**
 * useFireworksQuota - how many free-text prompts this browser has left.
 *
 * Be honest about what this is. `getVisitorId()` is a fingerprint computed in
 * the browser and cached in localStorage, so a new browser is a new visitor and
 * anyone who opens devtools can hand themselves a fresh identity. This is a
 * speed bump against casual overuse, not an access control.
 *
 * The spending limit that actually binds lives in the gateway, keyed on an IP
 * the client cannot forge, with a daily GPU-minute ceiling behind it. If this
 * hook is bypassed the gateway still refuses; if the gateway is unreachable the
 * page falls back to replaying recorded runs, which cost nothing.
 *
 * Follows the `likes` pattern rather than the marketplace one: the table is
 * append-only for anon, so the count cannot be edited down from a console. And
 * unlike `useMarketplace`, a failure here denies rather than granting credit --
 * a quota that opens up when the database is unreachable is not a quota.
 */

export const PROMPT_LIMIT = 3;

interface QuotaState {
  used: number;
  remaining: number;
  loading: boolean;
  /** True when the count could not be read, so the box stays closed. */
  unavailable: boolean;
}

export const useFireworksQuota = () => {
  const [state, setState] = useState<QuotaState>({
    used: 0,
    remaining: 0,
    loading: true,
    unavailable: false,
  });

  const refresh = useCallback(async () => {
    try {
      const visitorId = await getVisitorId();
      const { count, error } = await (supabase as any)
        .from('fireworks_prompt_usage')
        .select('*', { count: 'exact', head: true })
        .eq('visitor_id', visitorId);
      if (error) throw error;
      const used = count ?? 0;
      setState({ used, remaining: Math.max(0, PROMPT_LIMIT - used), loading: false, unavailable: false });
    } catch {
      // Deny rather than grant. The alternative -- treating an unreachable
      // database as "you have credit" -- is how the marketplace hook ends up
      // handing out tokens it never checked.
      setState({ used: PROMPT_LIMIT, remaining: 0, loading: false, unavailable: true });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Record one use. Returns false when the row could not be written. */
  const consume = useCallback(async (prompt: string): Promise<boolean> => {
    try {
      const visitorId = await getVisitorId();
      const { error } = await (supabase as any)
        .from('fireworks_prompt_usage')
        .insert({ visitor_id: visitorId, prompt: prompt.slice(0, 500) });
      if (error) throw error;
      setState((current) => ({
        ...current,
        used: current.used + 1,
        remaining: Math.max(0, current.remaining - 1),
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { ...state, limit: PROMPT_LIMIT, refresh, consume };
};

export default useFireworksQuota;
