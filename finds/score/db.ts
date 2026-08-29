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
 * would abort it, correctly, for being uncited. `finds_write_verdict` (W3,
 * migration 20260828210900) is one request and therefore one transaction.
 *
 * THE NEVER-TWICE RULE LIVES IN ONE PLACE. Selection reads
 * `finds_undigested_candidates`, never finds_candidates with a hand-rolled NOT
 * EXISTS. That view excludes a candidate only once it is in a SENT digest, so
 * a failed send does not burn finds Nikhil never saw.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateStatus, Criterion, EvidenceRow, VerdictScore, WriteVerdictArgs } from '../types.ts';

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

/** An evidence row whose gate verdict was issued for a DIFFERENT candidate. */
export interface UnattributableEvidence {
  evidence_id: string;
  url: string;
  crawl_run_id: string;
  /** The candidate the permitting verdict actually belongs to. */
  verdict_candidate_id: string;
}

export interface CandidateEvidence {
  /** The generation to score: the newest one with attributable rows. */
  latest: string | null;
  /** Attributable rows, every generation. scoreCandidate() narrows to `latest`. */
  rows: EvidenceRow[];
  /** Rows excluded, and why. Never silently dropped -- the caller reports these. */
  unattributable: UnattributableEvidence[];
}

/**
 * A candidate's evidence, with rows that are not actually about this candidate
 * removed and named.
 *
 * WHY THIS CHECK EXISTS. `finds_evidence.crawl_verdict_id` is a composite FK on
 * `(id, allowed)` pinned to true, so a row must name an ALLOW verdict -- but
 * nothing requires that verdict to have been issued for the SAME candidate. A
 * row can therefore claim to be evidence about candidate A while citing
 * permission granted for candidate B, at a URL neither of them owns. That is
 * not hypothetical: production holds exactly such a row (W4 wrote it to
 * demonstrate the gap, and finds_evidence is append-only so it cannot be
 * removed).
 *
 * Two distinct harms, and the second is the dangerous one:
 *
 *   1. It SHADOWS a real generation. Generations are ordered by fetched_at, so
 *      a later bogus row makes a candidate's genuine crawl invisible and the
 *      candidate silently unscoreable -- forever, because evidence is
 *      append-only. A silent omission is the failure this whole initiative
 *      exists to avoid.
 *   2. Its observations would be READ AS EVIDENCE. A row carrying fabricated
 *      `c1_corroborated` observations, inserted under another candidate's
 *      verdict but with this candidate's id and crawl_run_id, would be scored
 *      as corroboration and cited as such -- and the citation would satisfy
 *      every composite FK, because candidate and run both match.
 *
 * So attribution is checked on READ, in one place, for both the choice of
 * generation and the rows handed to the rubric. Excluded rows are returned
 * rather than dropped: the caller says so out loud (D6), because a filter that
 * hides its own work is how the next one of these goes unnoticed.
 */
export async function loadCandidateEvidence(
  db: SupabaseClient,
  candidateId: string,
): Promise<CandidateEvidence> {
  const { data, error } = await db
    .from('finds_evidence')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('fetched_at', { ascending: false });
  fail('reading candidate evidence', error);
  const all = (data ?? []) as EvidenceRow[];
  if (all.length === 0) return { latest: null, rows: [], unattributable: [] };

  const verdictIds = [...new Set(all.map((row) => row.crawl_verdict_id))];
  const { data: verdicts, error: verdictError } = await db
    .from('finds_crawl_verdicts')
    .select('id,candidate_id')
    .in('id', verdictIds);
  fail('reading the gate verdicts that permitted this evidence', verdictError);
  const ownerOf = new Map((verdicts ?? []).map((v) => [v.id as string, v.candidate_id as string]));

  const rows: EvidenceRow[] = [];
  const unattributable: UnattributableEvidence[] = [];
  for (const row of all) {
    const owner = ownerOf.get(row.crawl_verdict_id);
    // An unknown verdict is not a pass: if we cannot establish that this row
    // was permitted for THIS candidate, it is not evidence about it.
    if (owner === candidateId) {
      rows.push(row);
      continue;
    }
    unattributable.push({
      evidence_id: row.id,
      url: row.url,
      crawl_run_id: row.crawl_run_id,
      verdict_candidate_id: owner ?? '(no such verdict)',
    });
  }

  // Rows are already newest-first, so the first attributable row names the
  // generation to score.
  return { latest: rows[0]?.crawl_run_id ?? null, rows, unattributable };
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
export async function writeVerdicts(db: SupabaseClient, args: WriteVerdictArgs): Promise<void> {
  const { error } = await db.rpc('finds_write_verdict', args);
  if (error) {
    // PostgREST resolves an overload by argument NAMES, so a signature change
    // surfaces as "function not found" rather than as a wrong write. W3 made
    // p_rubric_version required for exactly that reason; say so, because the
    // message alone reads like a missing migration.
    const signature = /could not find the function|PGRST202/i.test(`${error.message} ${error.code ?? ''}`);
    throw new Error(
      `writing verdicts for candidate ${args.p_candidate_id}: ${error.message}` +
        (signature
          ? '\n\nPostgREST matches an overload by argument names, so this is either a missing migration ' +
            '(20260828210900_create_finds_write_verdict) or an argument-name drift between ' +
            'WriteVerdictArgs and the function. It is never a silent partial write.'
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

/* ========================================================================== */
/* audit -- the invariants of what is already written                          */
/* ========================================================================== */

export interface AuditFinding {
  ok: boolean;
  what: string;
  detail: string;
}

/**
 * Check, against the live database, the properties every verdict is supposed to
 * have. READ ONLY: it asserts, it never repairs. A repair here would hide the
 * thing worth knowing.
 *
 * This exists because "I verified it in a terminal once" is a weaker claim than
 * a command anyone can re-run, and because the two properties it checks are the
 * ones the schema cannot enforce on its own today -- the same-candidate gap in
 * finds_evidence (W3 has the fix merged, not yet applied) and the fact that a
 * verdict's citations should all belong to the generation it scored.
 */
export async function auditVerdicts(db: SupabaseClient): Promise<AuditFinding[]> {
  const [verdicts, citations, evidence] = await Promise.all([
    db.from('finds_verdicts').select('id,candidate_id,evidence_run_id,criterion,score,rubric_version,scored_by'),
    db.from('finds_verdict_evidence').select('verdict_id,evidence_id,candidate_id,evidence_run_id,stance'),
    db.from('finds_evidence').select('id,candidate_id,crawl_run_id'),
  ]);
  fail('auditing verdicts', verdicts.error);
  fail('auditing citations', citations.error);
  fail('auditing evidence', evidence.error);

  const v = verdicts.data ?? [];
  const ve = citations.data ?? [];
  const evById = new Map((evidence.data ?? []).map((e) => [e.id as string, e]));
  const verdictById = new Map(v.map((x) => [x.id as string, x]));
  const findings: AuditFinding[] = [];
  const check = (ok: boolean, what: string, detail: string) => findings.push({ ok, what, detail });

  const uncited = v.filter((x) => !ve.some((c) => c.verdict_id === x.id));
  check(uncited.length === 0, 'every verdict cites evidence (D7)', `${uncited.length} uncited`);

  const noVersion = v.filter((x) => !x.rubric_version);
  check(noVersion.length === 0, 'every verdict names the rubric that produced it', `${noVersion.length} without one`);

  const wrongRun = ve.filter((c) => verdictById.get(c.verdict_id as string)?.evidence_run_id !== c.evidence_run_id);
  check(wrongRun.length === 0, "each citation carries its verdict's generation", `${wrongRun.length} mismatched`);

  const strayEvidence = ve.filter((c) => {
    const e = evById.get(c.evidence_id as string);
    return !e || e.crawl_run_id !== c.evidence_run_id || e.candidate_id !== c.candidate_id;
  });
  check(
    strayEvidence.length === 0,
    'every cited row is in that generation, for that candidate',
    `${strayEvidence.length} outside it`,
  );

  const scales = v.filter((x) => (x.score as number) < 0 || (x.score as number) > 3);
  check(scales.length === 0, 'every score is inside 0-3', `${scales.length} outside`);

  return findings;
}
