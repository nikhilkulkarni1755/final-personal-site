/**
 * Which candidates a daily run crawls, and in what order.
 *
 * This file exists because the arithmetic does not work. R2 §5.3 caps a crawl
 * at 25 pages, 2 seconds apart, 300 s wall clock. W2's four connectors land
 * on the order of 130 new candidates a day. Even at the floor that is
 * 130 x 25 x 2s = 108 minutes, and the honest worst case -- a site publishing
 * `Crawl-delay: 10`, which R2 §10.2 measured on 4% of them -- is the 300 s cap
 * per candidate, or nearly eleven hours. No daily CI job can do that, and
 * pretending otherwise would mean a run that is killed halfway with no record
 * of where it stopped.
 *
 * So a run crawls a bounded prefix, and the interesting question is which one.
 *
 * THE ORDERING RULE: most independent sightings first, then newest first.
 *
 * W3's schema records one sighting per (candidate, source), so a product that
 * showed up on Peerlist and Show HN and GitHub on the same day has three. That
 * count is the only prior on "worth a look" that exists BEFORE we crawl, and
 * it is not a judgement W4 invented -- it is a count of what four independent
 * platforms actually did. DEPENDENCIES.md makes the same point from the other
 * end: "a launch appearing on three platforms in one day is part of the story".
 * Newest-first breaks ties because this is a daily digest and yesterday's
 * launch has already had its day.
 *
 * What this rule is NOT: an assessment of the product. It cannot be -- the
 * whole point of the crawl is that we do not know anything yet. It is a
 * queue order, and the candidates it does not reach keep `status = 'new'`
 * and are first in line tomorrow, ranked against that day's arrivals.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DatastoreError } from './persist.ts';

/** A candidate the runner may crawl, with the numbers that ordered it. */
export interface QueuedCandidate {
  id: string;
  product_url: string;
  name: string;
  first_seen_at: string;
  /** Distinct sources that reported this product. */
  sightings: number;
}

/**
 * How many candidates to consider before ranking.
 *
 * Deliberately far above any per-run crawl cap: we want the whole day's
 * arrivals in hand so the ranking picks the best of them, not the best of an
 * arbitrary first page. Ordered by first_seen_at so that if a day ever
 * overflows even this, what falls off the end is the oldest.
 */
const CONSIDER_LIMIT = 500;

/**
 * The day's unverified candidates, best first.
 *
 * Two round trips rather than one, because PostgREST cannot order by an
 * embedded aggregate. Ranking in memory over at most CONSIDER_LIMIT rows is
 * cheaper than asking W3 for a view, and it keeps the rule readable in the
 * file that has to justify it.
 */
export async function selectQueue(client: SupabaseClient, limit: number): Promise<QueuedCandidate[]> {
  const { data: candidates, error } = await client
    .from('finds_candidates')
    .select('id, product_url, name, first_seen_at')
    .eq('status', 'new')
    .order('first_seen_at', { ascending: false })
    .limit(CONSIDER_LIMIT);

  if (error) throw new DatastoreError(`could not read finds_candidates: ${error.message}`);
  if (!candidates || candidates.length === 0) return [];

  const ids = candidates.map((row) => row.id as string);
  const { data: sightings, error: sightingError } = await client
    .from('finds_candidate_sightings')
    .select('candidate_id, source_id')
    .in('candidate_id', ids);

  if (sightingError) {
    throw new DatastoreError(`could not read finds_candidate_sightings: ${sightingError.message}`);
  }

  // Distinct sources per candidate. The table is unique on
  // (source_id, external_id), so one source listing a product twice is two
  // rows -- counting rows would reward a platform that reposts.
  const sources = new Map<string, Set<string>>();
  for (const row of sightings ?? []) {
    const candidateId = row.candidate_id as string;
    let set = sources.get(candidateId);
    if (!set) sources.set(candidateId, (set = new Set()));
    set.add(row.source_id as string);
  }

  return candidates
    .map((row) => ({
      id: row.id as string,
      product_url: row.product_url as string,
      name: row.name as string,
      first_seen_at: row.first_seen_at as string,
      sightings: sources.get(row.id as string)?.size ?? 0,
    }))
    .sort((a, b) => b.sightings - a.sightings || b.first_seen_at.localeCompare(a.first_seen_at))
    .slice(0, limit);
}
