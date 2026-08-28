/**
 * The database side of publishing: read the private rows for one candidate,
 * write the public snapshot, take it down again.
 *
 * D17: privileged access is supabase-js with SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY, and the client is W2's `getSupabaseClient()`,
 * imported rather than reimplemented -- one place in the pipeline decides what
 * happens when the credential is absent, and it already fails loud per D6.
 *
 * FLAT READS, JOINED HERE, same as W5's db.ts: PostgREST embedding across four
 * tables with a filter on a fifth is harder to read than the join it replaces,
 * and this is code whose correctness has to be obvious.
 *
 * NOTHING IN THIS FILE DECIDES ANYTHING. Every rule that can refuse a publish
 * is in snapshot.ts, where it is pure and tested. This module only fetches and
 * writes, so that a change to the rules cannot hide in a query.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ApprovalRow,
  CitationStance,
  Criterion,
  EvidenceRow,
  GateUseRights,
  VerdictScore,
} from '../types.ts';
import type { CandidateCitation, PublishSource, NewPublishedFind } from './types.ts';

export { getSupabaseClient } from '../sources/db.ts';

/** One place to turn a PostgREST error into the operation that caused it. */
function fail(what: string, error: { message: string; hint?: string | null } | null): void {
  if (!error) return;
  throw new Error(`${what}: ${error.message}${error.hint ? ` (${error.hint})` : ''}`);
}

/** Slugs already in use, so a collision refuses instead of overwriting a live page. */
export async function takenSlugs(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from('finds_published').select('slug');
  fail('reading published slugs', error);
  return (data ?? []).map((r) => r.slug as string);
}

/**
 * The newest approval Nikhil has given for this find (D29).
 *
 * There is deliberately no "approved but not yet published" query here or in
 * the schema -- W3 declined the convenience view every other stage got, on the
 * grounds that it is the one missing ingredient for a three-line cron that
 * auto-publishes. Agreed, and not worked around: this reads approvals for a
 * candidate the caller has already named.
 *
 * Newest by `answered_at`, because a candidate can be re-crawled, re-digested
 * and approved again -- `finds_approvals` is unique on
 * (candidate_id, evidence_run_id), not on candidate alone.
 */
export async function loadApproval(db: SupabaseClient, candidateId: string): Promise<ApprovalRow> {
  const { data, error } = await db
    .from('finds_approvals')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('answered_at', { ascending: false })
    .limit(1);
  fail('reading approvals', error);
  const approval = (data ?? [])[0] as ApprovalRow | undefined;
  if (!approval) {
    throw new Error(
      `Nikhil has not approved candidate ${candidateId}. Nothing publishes without his ` +
        `explicit, per-find approval -- not a high score, not a threshold.`,
    );
  }
  return approval;
}

/** What one publish needs to read, plus the one thing the operator must be told. */
export interface PublishReadout {
  source: PublishSource;
  /**
   * The newest scored generation, when it is NOT the one being published.
   * Publishing what he approved is correct -- finds_published is a snapshot of
   * what he agreed to on the day -- but doing it silently while newer evidence
   * exists is not, so the CLI says so.
   */
  supersededBy: string | null;
}

/**
 * Everything snapshot.ts needs about one candidate, on ONE named crawl
 * generation -- the one his approval carries.
 *
 * The generation matters: re-crawling appends rather than overwrites, so
 * without pinning one a published find could mix a fresh crawl's score with a
 * stale crawl's quote. It is passed in rather than inferred because the
 * approval is what names it: he approved the evidence the digest showed him,
 * and a re-score since then is not something the publish path may substitute.
 */
export async function loadPublishSource(
  db: SupabaseClient,
  candidateId: string,
  evidenceRunId: string,
): Promise<PublishReadout> {
  const candidate = await db
    .from('finds_candidates')
    .select('id,name,tagline,product_url,first_seen_at')
    .eq('id', candidateId)
    .maybeSingle();
  fail('reading the candidate', candidate.error);
  if (!candidate.data) throw new Error(`No candidate ${candidateId}. Nothing to publish.`);

  const verdicts = await db
    .from('finds_verdicts')
    .select('id,criterion,score,evidence_run_id,created_at')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false });
  fail('reading verdicts', verdicts.error);
  const newest = verdicts.data?.[0];
  if (!newest) throw new Error(`Candidate ${candidateId} has never been scored. Nothing to publish.`);
  const generation = (verdicts.data ?? []).filter((v) => v.evidence_run_id === evidenceRunId);
  if (generation.length === 0) {
    throw new Error(
      `Candidate ${candidateId} has no scores on generation ${evidenceRunId}. The approval names ` +
        `a generation the verdicts do not have, which should be a foreign-key violation upstream.`,
    );
  }

  const [citations, sightings, sources] = await Promise.all([
    db
      .from('finds_verdict_evidence')
      .select('verdict_id,evidence_id,stance')
      .in('verdict_id', generation.map((v) => v.id as string)),
    db.from('finds_candidate_sightings').select('source_id').eq('candidate_id', candidateId),
    db.from('finds_sources').select('id,display_name'),
  ]);
  fail('reading citations', citations.error);
  fail('reading sightings', sightings.error);
  fail('reading sources', sources.error);

  const evidence = await db
    .from('finds_evidence')
    .select('id,url,quotes,crawl_verdict_id')
    .in('id', (citations.data ?? []).map((c) => c.evidence_id as string));
  fail('reading cited evidence', evidence.error);
  const evidenceById = new Map(
    (evidence.data ?? []).map((e) => [e.id as string, e as unknown as EvidenceRow]),
  );

  // The gate's USE decision for each cited page. Not decoration: a page we were
  // allowed to FETCH may still refuse a public excerpt or a public link, and
  // this lane is the only one that can honour that (R2's ACCESS/USE split).
  const rights = await db
    .from('finds_crawl_verdicts')
    .select('id,use_rights')
    .in('id', [...new Set([...evidenceById.values()].map((e) => e.crawl_verdict_id))]);
  fail('reading the USE rights of cited pages', rights.error);
  const rightsById = new Map(
    (rights.data ?? []).map((v) => [v.id as string, v.use_rights as GateUseRights | Record<string, never>]),
  );

  const criterionOf = new Map(generation.map((v) => [v.id as string, v.criterion as Criterion]));
  const built: CandidateCitation[] = [];
  for (const citation of citations.data ?? []) {
    const row = evidenceById.get(citation.evidence_id as string);
    const criterion = criterionOf.get(citation.verdict_id as string);
    if (!row || !criterion) continue;
    built.push({
      criterion,
      url: row.url,
      quote: row.quotes?.[0]?.text,
      stance: citation.stance as CitationStance,
      use_rights: rightsById.get(row.crawl_verdict_id) ?? null,
    });
  }

  const nameOf = new Map((sources.data ?? []).map((s) => [s.id as string, s.display_name as string]));
  const labels = [
    ...new Set(
      (sightings.data ?? [])
        .map((s) => nameOf.get(s.source_id as string))
        .filter((n): n is string => Boolean(n)),
    ),
  ].sort();

  return {
    supersededBy: (newest.evidence_run_id as string) === evidenceRunId ? null : (newest.evidence_run_id as string),
    source: {
      candidate: {
        id: candidate.data.id as string,
        name: candidate.data.name as string,
        tagline: (candidate.data.tagline as string | null) ?? null,
        product_url: candidate.data.product_url as string,
        first_seen_at: candidate.data.first_seen_at as string,
      },
      source_labels: labels,
      evidence_run_id: evidenceRunId,
      scores: generation.map((v) => ({
        criterion: v.criterion as Criterion,
        score: v.score as VerdictScore,
      })),
      citations: built,
    },
  };
}

/** The write. One row, one candidate; the table's UNIQUE on candidate_id
 *  refuses a second public page for the same product. */
export async function insertPublished(db: SupabaseClient, row: NewPublishedFind): Promise<void> {
  const { error } = await db.from('finds_published').insert(row);
  fail(`publishing ${row.slug}`, error);
}

/** The work-queue marker only. The finds_published row is the record. */
export async function markPublished(db: SupabaseClient, candidateId: string): Promise<void> {
  const { error } = await db.from('finds_candidates').update({ status: 'published' }).eq('id', candidateId);
  fail(`marking candidate ${candidateId} as published`, error);
}

/**
 * Take a find off the public page.
 *
 * `published_at = NULL` is the whole mechanism -- the RLS policy is
 * `USING (published_at IS NOT NULL AND published_at <= NOW())`, so clearing it
 * makes the row invisible to anon immediately, with no status column and no
 * second code path. The row STAYS, because the citations and the date he
 * approved it are the record of what was once public; deleting it would erase
 * the evidence of a claim we had made.
 */
export async function unpublishBySlug(db: SupabaseClient, slug: string): Promise<void> {
  const { data, error } = await db
    .from('finds_published')
    .update({ published_at: null })
    .eq('slug', slug)
    .select('slug');
  fail(`unpublishing ${slug}`, error);
  if ((data ?? []).length === 0) throw new Error(`No published find with slug ${JSON.stringify(slug)}.`);
}
