/**
 * The database side of scoring: read a crawl generation, write the verdicts,
 * read back what selection needs.
 *
 * D17: privileged access is supabase-js with SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY, and the client is W2's `getSupabaseClient()`,
 * imported rather than reimplemented -- one place in the pipeline decides what
 * happens when the credential is absent, and it already fails loud per D6.
 *
 * THE WRITE IS AN RPC, AND THAT IS NOT A STYLE CHOICE. D7's constraint trigger
 * is DEFERRABLE INITIALLY DEFERRED, so a verdict and its citations must commit
 * together. PostgREST gives one transaction per request, so writing them as two
 * `.insert()` calls would commit the verdict alone and the deferred trigger
 * would abort it, correctly, for being uncited. `finds_write_verdict`
 * (finds/score/verdict-rpc.sql, proposed to W3) is one request and therefore
 * one transaction. Until that function is migrated this path fails loudly with
 * the reason -- it does not fall back to a two-request write that cannot work.
 *
 * THE NEVER-TWICE RULE LIVES IN ONE PLACE. Selection reads
 * `finds_undigested_candidates`, never finds_candidates with a hand-rolled NOT
 * EXISTS. That view excludes a candidate only once it is in a SENT digest, so
 * a failed send does not burn finds Nikhil never saw.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateStatus, Criterion, EvidenceRow, VerdictScore } from '../types.ts';
import type { VerdictRpcArgs } from './persist.ts';
import type { SelectionCandidate } from './select.ts';

export { getSupabaseClient } from '../sources/db.ts';

/** Every read and write here goes through one place, so a PostgREST error
 *  surfaces as the operation that caused it rather than as `{}`. */
function fail(what: string, error: { message: string; hint?: string | null } | null): void {
  if (!error) return;
  throw new Error(`${what}: ${error.message}${error.hint ? ` (${error.hint})` : ''}`);
}

/** Candidates whose evidence has been collected and not yet scored. */
export async function candidatesToScore(
  db: SupabaseClient,
  status: CandidateStatus = 'crawled',
  limit = 500,
): Promise<{ id: string; status: CandidateStatus }[]> {
  const { data, error } = await db
    .from('finds_candidates')
    .select('id,status')
    .eq('status', status)
    .order('first_seen_at')
    .limit(limit);
  fail('reading candidates to score', error);
  return (data ?? []) as { id: string; status: CandidateStatus }[];
}

/** The most recent crawl generation for a candidate, or null if never crawled. */
export async function latestGeneration(db: SupabaseClient, candidateId: string): Promise<string | null> {
  const { data, error } = await db
    .from('finds_evidence')
    .select('crawl_run_id')
    .eq('candidate_id', candidateId)
    .order('fetched_at', { ascending: false })
    .limit(1);
  fail('reading the latest crawl generation', error);
  return (data?.[0] as { crawl_run_id: string } | undefined)?.crawl_run_id ?? null;
}

/** Every evidence row of one generation. JSONB arrives already parsed. */
export async function loadGeneration(
  db: SupabaseClient,
  candidateId: string,
  crawlRunId: string,
): Promise<EvidenceRow[]> {
  const { data, error } = await db
    .from('finds_evidence')
    .select('*')
    .eq('candidate_id', candidateId)
    .eq('crawl_run_id', crawlRunId)
    .order('url');
  fail('reading an evidence generation', error);
  return (data ?? []) as EvidenceRow[];
}

/**
 * How many URLs the gate refused for this candidate.
 *
 * Not derivable from evidence: finds_evidence's composite FK pins the crawl
 * verdict to allowed=true, so a refusal leaves no evidence row at all. Without
 * this number a rationale cannot tell "unsubstantiated after eight pages" from
 * "unsubstantiated after one".
 */
export async function refusedUrlCount(db: SupabaseClient, candidateId: string): Promise<number> {
  const { count, error } = await db
    .from('finds_crawl_verdicts')
    .select('id', { count: 'exact', head: true })
    .eq('candidate_id', candidateId)
    .eq('allowed', false);
  fail('counting refused URLs', error);
  return count ?? 0;
}

/** One transaction, on the database's side. See the header. */
export async function writeVerdicts(db: SupabaseClient, args: VerdictRpcArgs): Promise<void> {
  const { error } = await db.rpc('finds_write_verdict', args);
  if (error) {
    const missing = /function .*finds_write_verdict|could not find the function|PGRST202/i.test(
      `${error.message} ${error.code ?? ''}`,
    );
    throw new Error(
      `writing verdicts for candidate ${args.p_candidate_id}: ${error.message}` +
        (missing
          ? '\n\nfinds_write_verdict is not in the database. D7\'s citation check is a DEFERRED ' +
            'constraint trigger, so a verdict and its citations must commit together, and PostgREST ' +
            'gives one transaction per request -- there is no two-call version of this write that ' +
            'works. Apply finds/score/verdict-rpc.sql (proposed to W3 for migration) and re-run.'
          : ''),
    );
  }
}

/** The work-queue marker only. The verdict rows are the record of what happened. */
export async function markStatus(
  db: SupabaseClient,
  candidateId: string,
  status: CandidateStatus,
): Promise<void> {
  const { error } = await db.from('finds_candidates').update({ status }).eq('id', candidateId);
  fail(`marking candidate ${candidateId} as ${status}`, error);
}

/**
 * Everything selection needs, for candidates not already in a SENT digest.
 *
 * Assembled in JS rather than in SQL because PostgREST has no jsonb_object_agg:
 * three flat reads, joined here. The grouping rule is the one that matters and
 * it is unchanged -- each candidate is judged on its MOST RECENTLY SCORED
 * generation, so a re-crawled product is never scored against a mix of two.
 * A criterion that was unscoreable is simply absent, which is what lets
 * selection set the candidate aside rather than rank it as though it had lost.
 */
export async function loadSelectionCandidates(db: SupabaseClient): Promise<SelectionCandidate[]> {
  const [candidates, verdicts, sightings, sources] = await Promise.all([
    db.from('finds_undigested_candidates').select('id,name,tagline,product_url,first_seen_at'),
    db.from('finds_verdicts').select('candidate_id,evidence_run_id,criterion,score,rationale,created_at'),
    db.from('finds_candidate_sightings').select('candidate_id,source_id'),
    db.from('finds_sources').select('id,slug'),
  ]);
  fail('reading undigested candidates', candidates.error);
  fail('reading verdicts', verdicts.error);
  fail('reading sightings', sightings.error);
  fail('reading sources', sources.error);

  const slugOf = new Map((sources.data ?? []).map((s) => [s.id as string, s.slug as string]));
  const slugsFor = new Map<string, Set<string>>();
  for (const sighting of sightings.data ?? []) {
    const slug = slugOf.get(sighting.source_id as string);
    if (!slug) continue;
    const set = slugsFor.get(sighting.candidate_id as string) ?? new Set<string>();
    set.add(slug);
    slugsFor.set(sighting.candidate_id as string, set);
  }

  // The most recently created verdict names the generation to judge on.
  const newestRun = new Map<string, { run: string; at: string }>();
  for (const verdict of verdicts.data ?? []) {
    const seen = newestRun.get(verdict.candidate_id as string);
    if (!seen || (verdict.created_at as string) > seen.at) {
      newestRun.set(verdict.candidate_id as string, {
        run: verdict.evidence_run_id as string,
        at: verdict.created_at as string,
      });
    }
  }

  const out: SelectionCandidate[] = [];
  for (const candidate of candidates.data ?? []) {
    const latest = newestRun.get(candidate.id as string);
    if (!latest) continue; // never scored: not a rejection, just not ready
    const scores: Partial<Record<Criterion, VerdictScore>> = {};
    const rationales: Partial<Record<Criterion, string>> = {};
    for (const verdict of verdicts.data ?? []) {
      if (verdict.candidate_id !== candidate.id || verdict.evidence_run_id !== latest.run) continue;
      scores[verdict.criterion as Criterion] = verdict.score as VerdictScore;
      rationales[verdict.criterion as Criterion] = verdict.rationale as string;
    }
    out.push({
      candidate_id: candidate.id as string,
      name: candidate.name as string,
      tagline: (candidate.tagline as string | null) ?? null,
      product_url: candidate.product_url as string,
      evidence_run_id: latest.run,
      source_slugs: [...(slugsFor.get(candidate.id as string) ?? [])].sort(),
      scores,
      rationales,
      first_seen_at: new Date(candidate.first_seen_at as string).toISOString(),
    });
  }
  return out;
}
