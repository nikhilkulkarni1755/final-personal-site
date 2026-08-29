/**
 * C4 -- "agentic / MCP friendly".
 *
 * The criterion where it would be easiest to write vibes and call it a rubric,
 * and also the one where that is least necessary: agent-readiness is mostly
 * MEASURABLE. A status code on llms.txt, a linked OpenAPI document, an MCP
 * endpoint URL that actually appears in the site's own links -- none of those
 * is an opinion. W4 collects them in finds/verify/signals.ts `collectC4()`;
 * this file only weighs them.
 *
 * THE DISTINCTION THAT CARRIES THE SCORE is measured versus advertised.
 * Writing "MCP server" on a landing page is a CLAIM. A linked /mcp URL is a
 * FACT. W4 keeps them as separate observation kinds precisely so W5 does not
 * have to guess, and the whole scale hangs off that split:
 *
 *     3  a linked MCP endpoint, or two other measured surfaces
 *     2  one measured surface, or two advertised ones
 *     1  at most one advertised surface and nothing measured
 *     0  the only agent surface advertised is a DEAD one
 *
 * MCP gets its own line at the top because Nikhil named it. A product with a
 * real, linked MCP endpoint is the thing he asked for, and one measured
 * surface of that specific kind outranks two of any other.
 *
 * DEAD STANDARDS. agent-ready-coord's R1 §10 established that ai-plugin.json,
 * agents.json, apps.txt, /.well-known/mcp.json, A2A agent-card.json and NLWeb
 * are all dead surfaces -- shut down, abandoned, or specced and closed. W4
 * records them as `c4_dead_standard_claimed` and says they must not count
 * toward C4. They do not. And when they are the ONLY agent story a site tells,
 * the evidence does not merely fail to support C4, it argues against it: the
 * site is advertising agent-readiness copied from a 2023 blog post. That is a
 * 0, citing the dead-standard rows as contradicting -- not a C1 contradiction,
 * which is about the site disagreeing with itself, but a C4 one.
 */

import type { EvidenceRow } from '../types.ts';
import type { CriterionScore, UnscoreableReason } from './types.ts';
import { RUBRIC_VERSION, citeRows, corpusStats, criterionScore, findings } from './rubric.ts';

/**
 * MEASURED. Each of these is a status code or a URL the crawl actually saw,
 * never a sentence someone wrote. `c4_mcp_endpoint_linked` is measured only
 * when it carries a URL -- W4 emits it with a null value when MCP is mentioned
 * in prose and no endpoint is linked, and says so in its own words: "the
 * mention is a claim, not a measurement."
 */
const MCP_ENDPOINT = 'c4_mcp_endpoint_linked';
const MEASURED = ['c4_llms_txt', 'c4_openapi_spec_linked', 'c4_markdown_docs'] as const;

/** ADVERTISED. A sentence on one of their pages. Real evidence, weaker kind. */
const ADVERTISED = ['c4_mcp', 'c4_api', 'c4_cli', 'c4_webhooks', 'c4_sdk'] as const;

/** Recorded when we looked for a surface and it was not there. */
const ABSENT = [
  'c4_llms_txt_absent',
  'c4_openapi_spec_absent',
  'c4_mcp_absent',
  'c4_api_absent',
  'c4_cli_absent',
  'c4_webhooks_absent',
  'c4_sdk_absent',
] as const;

const DEAD = 'c4_dead_standard_claimed';

export type C4Result =
  | { kind: 'scored'; score: CriterionScore }
  | { kind: 'unscoreable'; reason: UnscoreableReason; detail: string };

/**
 * Score C4 for one crawl generation.
 *
 * `rows` must already be narrowed to a single crawl_run_id. `urlsRefused` comes
 * from finds_crawl_verdicts and only ever enters the rationale -- a site that
 * refused us pages is not thereby less agent-friendly, it is a site we saw
 * less of, and the two must not be conflated.
 */
export function scoreC4(rows: readonly EvidenceRow[], urlsRefused = 0): C4Result {
  if (rows.length === 0) {
    return { kind: 'unscoreable', reason: 'no_evidence', detail: 'No evidence rows in this crawl generation.' };
  }

  const mcp = findings(rows, MCP_ENDPOINT).filter((finding) => finding.value !== null);
  const measured = findings(rows, ...MEASURED);
  const advertised = findings(rows, ...ADVERTISED);
  const dead = findings(rows, DEAD);
  const absent = findings(rows, ...ABSENT);

  // W4 records absence explicitly, so "no C4 signals" and "no C4 pass ran" are
  // distinguishable. Without either, there is nothing to judge and inventing a
  // 1 would be inventing a finding (D6).
  if (mcp.length + measured.length + advertised.length + dead.length + absent.length === 0) {
    return {
      kind: 'unscoreable',
      reason: 'no_claims_extracted',
      detail:
        `${rows.length} evidence row(s) carry no c4_* observation, present or absent, so the agent-surface ` +
        'pass did not run against this generation.',
    };
  }

  const stats = corpusStats(rows, urlsRefused);
  const deadClause = dead.length > 0 ? ` ${dead.length} dead agent surface(s) were advertised and excluded.` : '';
  const done = (score: 0 | 1 | 2 | 3, rationale: string, citations: CriterionScore['citations']): C4Result => ({
    kind: 'scored',
    score: criterionScore('C4', score, rationale + deadClause, citations, stats),
  });

  // ---- 0: the only agent story on the site is a dead one. ------------------
  if (mcp.length + measured.length + advertised.length === 0) {
    if (dead.length > 0) {
      return done(
        0,
        `CONTRADICTED: the only agent-facing surface this site advertises is dead (${dead.length} of them). ` +
          'Per agent-ready-coord R1 §10 these are shut down or abandoned, so the evidence does not merely ' +
          'fail to support agent-readiness, it argues against it.',
        citeRows(dead, 'contradicts', 'dead agent surface(s)'),
      );
    }
    return done(
      1,
      'NO EVIDENCE: we looked for llms.txt, an OpenAPI document, an MCP endpoint, an API, a CLI, webhooks ' +
        'and an SDK, and found none of them advertised or linked. That is an absence of evidence and scores ' +
        '1, not 0 -- a product can be excellent and simply not be built for agents.',
      citeRows(absent, 'inconclusive', 'absent agent surface(s)'),
    );
  }

  const supporting = [...mcp, ...measured, ...advertised];

  // ---- 3: a linked MCP endpoint, or two other measured surfaces. -----------
  if (mcp.length > 0 || measured.length >= 2) {
    return done(
      3,
      mcp.length > 0
        ? `CLEARLY SUPPORTED: an MCP endpoint is linked from the site's own pages, not merely named in prose ` +
          `(${mcp.length} URL(s)), alongside ${measured.length} other measured surface(s) and ` +
          `${advertised.length} advertised one(s). This is the criterion Nikhil named, measured rather than claimed.`
        : `CLEARLY SUPPORTED: ${measured.length} agent surfaces are measured rather than advertised -- a status ` +
          `code or a linked document, not a sentence -- alongside ${advertised.length} advertised one(s).`,
      citeRows(supporting, 'supports', 'agent surface(s)'),
    );
  }

  // ---- 2: one measured surface, or two advertised ones. --------------------
  if (measured.length === 1 || advertised.length >= 2) {
    return done(
      2,
      `PARTIALLY SUPPORTED: ${measured.length} measured surface(s) and ${advertised.length} advertised one(s). ` +
        `Rubric ${RUBRIC_VERSION} reserves 3 for a linked MCP endpoint or two measured surfaces, because a ` +
        'landing page saying "API" is a claim and a linked OpenAPI document is a fact.',
      citeRows(supporting, 'supports', 'agent surface(s)'),
    );
  }

  // ---- 1: a single advertised word, and nothing measured. ------------------
  return done(
    1,
    'BARELY EVIDENCED: exactly one agent surface is mentioned in prose and nothing at all is measured -- no ' +
      'llms.txt, no linked spec, no MCP endpoint. One word on a marketing page is not enough to call a ' +
      'product agent-friendly, so this scores 1 rather than 2.',
    citeRows(supporting, 'inconclusive', 'advertised-only agent surface(s)'),
  );
}
