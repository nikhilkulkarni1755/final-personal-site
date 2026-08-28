import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Find } from './types';

/** Raw shape of a `finds_published` row, until W3's migration lands in generated Database types. */
interface FindRow {
  id: string;
  name: string;
  url: string;
  tagline: string;
  source: string;
  found_at: string;
  claim_verified: string;
  rare_problem: string;
  anyone_can_use: string;
  agentic_friendly: string;
}

/**
 * Reads the `finds_published` table -- the only public-readable table in the finds-coord
 * initiative (see ~/nsk1755/finds-coord/README.md). Follows the fail-closed
 * pattern from useFireworksQuota: a missing table, an RLS error, or a genuinely
 * empty table all resolve to an empty list rather than stub data (DECISIONS
 * D6). The page renders the same honest empty state in every one of those
 * cases -- there is no "error" UI to fake.
 */
export function useFinds() {
  const [finds, setFinds] = useState<Find[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // 'finds_published' isn't a key of the generated Database type until W3's
        // migration lands, same workaround as useFireworksQuota.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('finds_published')
          .select('*')
          .order('found_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) {
          setFinds(
            ((data ?? []) as FindRow[]).map((row) => ({
              id: row.id,
              name: row.name,
              url: row.url,
              tagline: row.tagline,
              source: row.source,
              foundAt: row.found_at,
              evidence: {
                claimVerified: row.claim_verified,
                rareProblem: row.rare_problem,
                anyoneCanUse: row.anyone_can_use,
                agenticFriendly: row.agentic_friendly,
              },
            })),
          );
        }
      } catch {
        if (!cancelled) setFinds([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { finds, loading };
}

export default useFinds;
