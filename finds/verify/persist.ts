/**
 * Writing a crawl pass to Postgres: the gate verdicts first, then the evidence
 * that cites them.
 *
 * That order is not a preference. `finds_evidence.crawl_verdict_id` is a
 * composite foreign key on (id, allowed) pinned to true, so a row of evidence
 * that does not name the ALLOW verdict permitting it is a foreign-key
 * violation. "W4 may not fetch a byte except through W1's gate" stopped being
 * a convention when W3 shipped that constraint, and this module is written to
 * satisfy it rather than to work around it.
 *
 * Both tables are append-only, enforced by triggers that refuse UPDATE, DELETE
 * and TRUNCATE for every caller including the service role. So there is no
 * update path and no upsert here: re-crawling appends a new generation under a
 * new crawl_run_id and the old one stays exactly as it was. A verdict records
 * which generation it scored; overwriting would make every citation ambiguous.
 */

import { createClient } from '@supabase/supabase-js';
import type { CrawlRecord, CrawlResult } from './crawl.ts';
import { registrableDomain } from './scope.ts';
import type { GateDecision, NewCrawlVerdict, NewEvidence } from './types.ts';

/**
 * DECISIONS D17 fixes these names for every lane. SUPABASE_URL falls back to
 * VITE_SUPABASE_URL because the site already defines that one; the service-role
 * key has no VITE_ fallback and must never get one -- a VITE_ prefix ships it
 * to every browser, and it bypasses RLS.
 */
function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value) {
    throw new Error(
      `${name} is not set. W4 cannot write evidence without it and will not pretend it did. ` +
        `finds_evidence and finds_crawl_verdicts REVOKE anon and authenticated, so the service ` +
        `role is required (DECISIONS D17).`,
    );
  }
  return value;
}

/**
 * A gate decision, as a row of `finds_crawl_verdicts`.
 *
 * Throws rather than filling a gap. Both refusals below are cases where the
 * only way to produce a row would be to invent the part the gate did not
 * supply, and inventing it is precisely what D6 forbids -- these rows are the
 * answer to "why did you crawl me", so a guessed field is a false answer.
 */
export function verdictRowFor(candidateId: string, decision: GateDecision): NewCrawlVerdict {
  if (decision.reason_code === null || decision.deciding_signal === null) {
    throw new Error(
      `Refusing to persist a verdict for ${decision.url}: the gate (${decision.gate_version}) named ` +
        `no reason_code or deciding_signal, and W4 will not invent one.`,
    );
  }
  if (decision.expires_at === null && decision.reason_code !== 'manual_denylist') {
    throw new Error(
      `Refusing to persist a verdict for ${decision.url}: expires_at is null and the reason is ` +
        `${decision.reason_code}. R2 §7 allows that only for manual_denylist, and the schema enforces it.`,
    );
  }
  return {
    rubric_version: decision.rubric_version,
    gate_version: decision.gate_version,
    candidate_id: candidateId,
    url: decision.url,
    authority: decision.authority,
    registrable_domain: registrableDomain(decision.url),
    allowed: decision.allowed,
    reason_code: decision.reason_code,
    reason_detail: decision.reason_detail,
    deciding_signal: decision.deciding_signal,
    deciding_rule: decision.deciding_rule,
    deciding_group: decision.deciding_group,
    precedence_rule: decision.precedence_rule,
    // Cast, not conversion: W1 omits `reserved_by[].restricts` which W3's type
    // requires (see types.ts). The column is JSONB and takes what the gate said
    // verbatim; W4 does not fabricate the missing field to satisfy a type.
    use_rights: (decision.use_rights ?? {}) as NewCrawlVerdict['use_rights'],
    crawl_budget: decision.crawl_budget,
    robots: decision.robots,
    expires_at: decision.expires_at,
  };
}

export interface PersistResult {
  crawlRunId: string;
  verdicts: number;
  evidence: number;
}

export async function persistCrawl(candidateId: string, result: CrawlResult): Promise<PersistResult> {
  const records: readonly CrawlRecord[] = result.records;
  if (records.length === 0) {
    throw new Error('Refusing to record a crawl pass that produced no rows; even a refusal produces one.');
  }

  const supabase = createClient(
    requireEnv('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  // Verdicts first, including the DENYs: those rows are the proof we behaved,
  // and R2 §6.3 says a refusal produces a row exactly as a fetch does.
  const verdictRows = records.map((record) => verdictRowFor(candidateId, record.decision));
  const { data: verdicts, error: verdictError } = await supabase
    .from('finds_crawl_verdicts')
    .insert(verdictRows)
    .select('id');
  if (verdictError) throw new Error(`finds_crawl_verdicts insert failed: ${verdictError.message}`);
  if (verdicts?.length !== records.length) {
    throw new Error(`Expected ${records.length} verdict ids back, got ${verdicts?.length ?? 0}.`);
  }

  // Evidence only for what we were allowed to fetch. A refusal's proof is its
  // verdict row; an evidence row citing a DENY is an FK violation by design.
  const evidenceRows: NewEvidence[] = records.flatMap((record, index) =>
    record.decision.allowed ? [{ ...record.evidence, crawl_verdict_id: verdicts[index]!.id }] : [],
  );
  if (evidenceRows.length === 0) {
    return { crawlRunId: result.crawlRunId, verdicts: verdicts.length, evidence: 0 };
  }

  const { data: evidence, error: evidenceError } = await supabase
    .from('finds_evidence')
    .insert(evidenceRows)
    .select('id');
  if (evidenceError) throw new Error(`finds_evidence insert failed: ${evidenceError.message}`);

  return { crawlRunId: result.crawlRunId, verdicts: verdicts.length, evidence: evidence?.length ?? 0 };
}
