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

import type { Criterion, EvidenceRow, VerdictScore } from '../types.ts';
import type { CorpusStats, CriterionScore, ScoreCitation } from './types.ts';

/**
 * Bump on ANY change that could move a score for unchanged evidence: a
 * threshold, a rollup rule, a new observation kind consumed. Do not bump for
 * wording or refactors -- a version that changes when nothing changed is
 * exactly as useless as one that does not change when something did.
 */
export const RUBRIC_VERSION = '1.2';

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

/**
 * Assemble one criterion's verdict. Every score goes through here, so no
 * criterion can forget to state its corpus or to stamp the rubric version it
 * was decided under.
 */
export function criterionScore(
  criterion: Criterion,
  score: VerdictScore,
  rationale: string,
  citations: ScoreCitation[],
  stats: CorpusStats,
): CriterionScore {
  return {
    criterion,
    score,
    rationale: `${rationale} ${corpusClause(stats)}`,
    citations,
    rubric_version: RUBRIC_VERSION,
  };
}

/* -------------------------------------------------------------------------- */
/* reading W4's observations, and turning them into citations                   */
/* -------------------------------------------------------------------------- */

/** One observation of a given kind, and the evidence row it was recorded on. */
export interface Finding {
  row: EvidenceRow;
  detail: string;
  value: string | number | boolean | null;
}

/**
 * Every observation of these kinds, across a generation.
 *
 * Kinds are the contract between W4 (which collects) and W5 (which judges).
 * A kind W4 stops emitting must show up here as an empty list -- never as a
 * silently missing signal that quietly moves a score.
 */
export function findings(rows: readonly EvidenceRow[], ...kinds: string[]): Finding[] {
  const wanted = new Set(kinds);
  const found: Finding[] = [];
  for (const row of rows) {
    for (const observation of row.observations) {
      if (wanted.has(observation.kind)) {
        found.push({ row, detail: observation.detail ?? '', value: observation.value ?? null });
      }
    }
  }
  return found;
}

/**
 * One citation per distinct evidence row, so a forty-claim diff cites four
 * pages rather than forty times. The count is kept in the note: a reader
 * following the citation needs to know how much of the row it stands for.
 */
export function citeRows(
  found: readonly Finding[],
  stance: ScoreCitation['stance'],
  label: string,
): ScoreCitation[] {
  const byRow = new Map<string, { row: EvidenceRow; count: number }>();
  for (const finding of found) {
    const seen = byRow.get(finding.row.id);
    if (seen) seen.count += 1;
    else byRow.set(finding.row.id, { row: finding.row, count: 1 });
  }
  return [...byRow.values()].map(({ row, count }) => ({
    evidence_id: row.id,
    stance,
    note: `${count} ${label} recorded against ${row.url} (${row.page_role})`,
  }));
}

/**
 * Combine citation lists that may name the same evidence row twice.
 *
 * A verdict can legitimately cite one page for two reasons -- a pricing page
 * that offers a free tier AND demands a terminal -- but `finds_verdict_evidence`
 * is keyed on (verdict_id, evidence_id), so the row may appear once. Stance
 * precedence is contradicts > supports > inconclusive: the strongest claim
 * about a row is the one worth recording, and a row that argues against a
 * criterion must never be softened by also having supported it.
 */
export function mergeCitations(...lists: ScoreCitation[][]): ScoreCitation[] {
  const rank: Record<ScoreCitation['stance'], number> = { contradicts: 2, supports: 1, inconclusive: 0 };
  const byEvidence = new Map<string, ScoreCitation>();
  for (const citation of lists.flat()) {
    const seen = byEvidence.get(citation.evidence_id);
    if (!seen) {
      byEvidence.set(citation.evidence_id, { ...citation });
      continue;
    }
    seen.note = `${seen.note}; ${citation.note}`;
    if (rank[citation.stance] > rank[seen.stance]) seen.stance = citation.stance;
  }
  return [...byEvidence.values()];
}
