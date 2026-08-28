import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { VisiblePublishedFind } from '../../../finds/types';

/**
 * Reads one row of `finds_published` by slug, for the /interesting-finds/:slug
 * detail page. `find: null` covers three cases identically, on purpose: the
 * slug never existed, the query failed, and the find was unpublished
 * (published_at set back to NULL -- W11 supports this, row retained). RLS
 * already refuses anon any row that isn't currently published, so an
 * unpublished find's URL degrades to "not found" rather than leaking that it
 * once existed or erroring.
 */
export function useFind(slug: string | undefined) {
  const [find, setFind] = useState<VisiblePublishedFind | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) {
      setFind(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        // 'finds_published' isn't a key of the generated Database type until
        // Supabase types are regenerated post-migration, same workaround as
        // useFinds/useFireworksQuota.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('finds_published')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setFind((data ?? null) as VisiblePublishedFind | null);
      } catch {
        if (!cancelled) setFind(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { find, loading };
}

export default useFind;
