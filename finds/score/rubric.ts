/**
 * The rubric's shared machinery: its version, how a score identifies itself,
 * and the read-only helpers every criterion uses to look at a crawl generation.
 *
 * Two properties this file exists to guarantee:
 *
 *   DERIVED AND REPRODUCIBLE. Same evidence in, same score out. Nothing here
 *   reads a clock, a random number, or the network. A verdict is a pure
 *   function of (evidence rows, corpus stats, rubric version).
 *
 *   INTERPRETABLE LATER. R2's rubric will reach v1.2 and old verdicts must
 *   still be readable, so the version travels with every score.
 */

import type { EvidenceRow } from '../types.ts';
import type { CorpusStats } from './types.ts';

/**
 * Bump on ANY change that could move a score for unchanged evidence: a
 * threshold, a rollup rule, a new observation kind consumed. Do not bump for
 * wording or refactors -- a version that changes when nothing changed is
 * exactly as useless as one that does not change when something did.
 */
export const RUBRIC_VERSION = '1.0';

/**
 * What goes in finds_verdicts.scored_by.
 *
 * That column is documented as "model id, or 'human'". This rubric is neither:
 * it is a deterministic function, so it names itself as one. The rubric version
 * rides here because finds_verdicts has no `rubric_version` column
 * (finds_crawl_verdicts does) -- PROPOSED to the coordinator. When the column
 * lands, this stays accurate and the column is backfillable from it, so nothing
 * has to be rewritten.
 *
 * A criterion judged with model help must pass the model id, and the evidence
 * it read plus the reason it gave must still be persisted as citations and
 * rationale. "The model said 7" is not auditable and D7 forbids it.
 */
export function scoredBy(model?: string): string {
  return model ? `${model}+rubric/${RUBRIC_VERSION}` : `rubric/${RUBRIC_VERSION}`;
}

/* -------------------------------------------------------------------------- */
/* looking at a crawl generation                                               */
/* -------------------------------------------------------------------------- */

/**
 * The evidence rows of ONE crawl pass, in a stable order.
 *
 * Evidence is append-only, so a candidate accumulates generations; scoring one
 * generation against another's rows would make `evidence_run_id` a lie. The
 * sort makes the output of every criterion byte-stable across two runs that
 * read the same rows in a different order.
 */
export function generation(rows: readonly EvidenceRow[], crawlRunId: string): EvidenceRow[] {
  return rows
    .filter((row) => row.crawl_run_id === crawlRunId)
    .sort((a, b) => (a.url === b.url ? a.id.localeCompare(b.id) : a.url.localeCompare(b.url)));
}

/**
 * How much we were actually allowed to see.
 *
 * `urlsRefused` cannot be derived from evidence: finds_evidence's composite FK
 * pins the gate verdict to allowed=true, so a refused URL leaves no evidence
 * row at all. The caller reads it from finds_crawl_verdicts and passes it in.
 * It defaults to 0 and every rationale states it, because "unsubstantiated
 * after reading eight pages" and "unsubstantiated after reading one" are
 * different findings that would otherwise be indistinguishable.
 */
export function corpusStats(rows: readonly EvidenceRow[], urlsRefused = 0): CorpusStats {
  return {
    pages_read: rows.length,
    pages_ok: rows.filter((row) => row.http_status !== null && row.http_status >= 200 && row.http_status < 300)
      .length,
    urls_refused: urlsRefused,
  };
}

/** One clause, appended to every rationale, so no score hides its corpus. */
export function corpusClause(stats: CorpusStats): string {
  return (
    `Corpus: ${stats.pages_read} page(s) fetched (${stats.pages_ok} answered 2xx), ` +
    `${stats.urls_refused} URL(s) refused by the permission gate.`
  );
}
