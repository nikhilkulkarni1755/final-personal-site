import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { VisiblePublishedFind } from '../../../finds/types';

/**
 * Reads `finds_published` -- the only public-readable table in the finds-coord
 * initiative (DECISIONS D8). Follows the fail-closed pattern from
 * useFireworksQuota: a missing table, an RLS error, or a genuinely empty table
 * all resolve to an empty list rather than stub data (DECISIONS D6). The page
 * renders the same honest empty state in every one of those cases -- there is
 * no "error" UI to fake.
 *
 * No extra filter on published_at: the table's own RLS policy already refuses
 * anon any row that isn't published (DEPENDENCIES.md D8 note), so every row
 * this hook can see is a VisiblePublishedFind by construction.
 */
export function useFinds() {
  const [finds, setFinds] = useState<VisiblePublishedFind[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // 'finds_published' isn't a key of the generated Database type until
        // Supabase types are regenerated post-migration, same workaround as
        // useFireworksQuota.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('finds_published')
          .select('*')
          .order('published_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setFinds((data ?? []) as VisiblePublishedFind[]);
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
