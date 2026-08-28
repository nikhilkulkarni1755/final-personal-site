/**
 * One crawl pass over one candidate, producing rows for `finds_evidence`.
 *
 * Everything this lane is for meets here: ask the gate, fetch only what it
 * permits, read the pages, diff the claims, and write down what happened --
 * including every refusal, every 404 and every page we could not render. W3's
 * migration is explicit that a 404 on /docs is evidence and not a missing row,
 * and the same goes for a DENY: the refusal rows are the proof we behaved.
 *
 * This does not score. W5 scores. The split is what makes a verdict auditable:
 * every number W5 emits has to cite a row that came out of here.
 */

import { randomUUID } from 'node:crypto';
import { R2_CAPS } from './config.ts';
import { diffClaims, extractClaims } from './claims.ts';
import type { CorpusPage } from './claims.ts';
import { looksLikeEmptyShell, pageRole, parsePage } from './extract.ts';
import { gatedFetch, isNeverTouch } from './gate.ts';
import { createRunState } from './gateAdapter.ts';
import { renderPage } from './render.ts';
import { normalise, parseLlmsTxt, parseSitemap, prioritise } from './scope.ts';
import { collectC2, collectC3, collectC4 } from './signals.ts';
import type { EvidenceObservation, EvidenceQuote, FetchOutcome, GateDecision, NewEvidence } from './types.ts';

export interface CrawlOptions {
  candidateId: string;
  productUrl: string;
  /** Defaults to a fresh UUID: one crawl pass, one id, per W3's schema note. */
  crawlRunId?: string;
}

/**
 * One evidence row and the gate decision that permitted it, kept together.
 *
 * `finds_evidence.crawl_verdict_id` is a composite FK on (id, allowed) pinned
 * to true, so a row cannot be inserted without naming the ALLOW that permitted
 * it -- "W4 may not fetch a byte except through the gate" is enforced by the
 * database, not by convention. The id only exists after the verdict is
 * inserted, so the crawler carries the decision and persist.ts resolves it.
 */
export interface CrawlRecord {
  decision: GateDecision;
  evidence: Omit<NewEvidence, 'crawl_verdict_id'>;
}

export interface CrawlResult {
  crawlRunId: string;
  /** One per URL asked about, in the order it was asked. */
  records: CrawlRecord[];
}

type PartialEvidence = Omit<NewEvidence, 'crawl_verdict_id'>;

function evidenceFor(base: Pick<NewEvidence, 'candidate_id' | 'crawl_run_id'>, outcome: FetchOutcome): PartialEvidence {
  const role = pageRole(outcome.url);
  if (outcome.kind === 'refused') {
    return {
      ...base,
      url: outcome.url,
      page_role: role,
      http_status: null,
      fetched_at: outcome.decision.decided_at,
      observations: [
        {
          kind: 'gate_refused',
          detail: `The permission gate refused this URL: ${outcome.decision.reason_detail}. No request was sent.`,
          value: outcome.decision.reason_code,
        },
      ],
    };
  }
  if (outcome.kind === 'error') {
    return {
      ...base,
      url: outcome.url,
      page_role: role,
      http_status: null,
      fetched_at: outcome.fetched_at,
      observations: [
        { kind: 'fetch_failed', detail: `The gate allowed this URL but the fetch failed: ${outcome.error}`, value: null },
      ],
    };
  }
  return {
    ...base,
    url: outcome.final_url,
    page_role: role,
    http_status: outcome.http_status,
    content_type: outcome.content_type,
    content_sha256: outcome.content_sha256,
    fetched_at: outcome.fetched_at,
    observations: [
      {
        kind: 'fetched',
        detail: `GET ${outcome.url} returned ${outcome.http_status} in ${outcome.elapsed_ms} ms${outcome.truncated ? ', body truncated at the 2 MB cap' : ''}`,
        value: outcome.http_status,
      },
    ],
  };
}

/** Text of an HTML page, rendering it first when a plain GET returned a shell. */
async function readablePage(
  outcome: Extract<FetchOutcome, { kind: 'fetched' }>,
  observations: EvidenceObservation[],
): Promise<ReturnType<typeof parsePage>> {
  const parsed = parsePage(outcome.body);
  const isHtml = (outcome.content_type ?? '').includes('html');
  if (!isHtml || !looksLikeEmptyShell(parsed)) return parsed;

  try {
    const rendered = await renderPage(outcome.url);
    observations.push({
      kind: 'rendered_with_browser',
      detail:
        `A plain GET returned ${parsed.text.length} characters of text, so the page was rendered. ` +
        `Origins contacted: ${rendered.contactedOrigins.join(', ') || 'none'}. ` +
        `${rendered.blockedSubresources} image/media/font/stylesheet request(s) refused per R2 §5.3.`,
      value: rendered.contactedOrigins.length,
    });
    return parsePage(rendered.html);
  } catch (cause) {
    observations.push({
      kind: 'spa_shell_not_rendered',
      detail:
        `A plain GET returned ${parsed.text.length} characters of text, which is a JS-rendered shell, and ` +
        `the browser was unavailable: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        `The evidence below is from the shell, not from what a visitor sees.`,
      value: null,
    });
    return parsed;
  }
}

/**
 * Crawl one candidate.
 *
 * The order is R2 §5.1's: llms.txt, then robots.txt's Sitemap: directives (the
 * gate already read them), then /sitemap.xml only if there were none, then
 * in-page links. Every one of those URLs is put to the gate individually.
 */
export async function crawlCandidate(options: CrawlOptions): Promise<CrawlResult> {
  const crawlRunId = options.crawlRunId ?? randomUUID();
  // One RunState for the whole pass. R2 P2/P3 are per-run state: without a
  // shared one, an origin that refuses us on page 3 gets asked again on pages
  // 4 through 25, which is precisely the behaviour a blocked site complains
  // about.
  const runState = createRunState();
  const base = { candidate_id: options.candidateId, crawl_run_id: crawlRunId };
  const records: CrawlRecord[] = [];
  const corpus: CorpusPage[] = [];
  const discoveredUrls = new Set<string>();
  const deadline = Date.now() + R2_CAPS.wallClockMs;

  const home = new URL(options.productUrl);
  home.hash = '';
  const homeUrl = home.toString();

  const fetchAndRecord = async (url: string): Promise<FetchOutcome> => {
    const outcome = await gatedFetch(url, runState, { candidateId: options.candidateId });
    records.push({ decision: outcome.decision, evidence: evidenceFor(base, outcome) });
    return outcome;
  };

  /* -- the landing page. Everything else is optional; this is not. --------- */
  const homeOutcome = await fetchAndRecord(homeUrl);
  const homeRow = records.at(-1)!.evidence;
  if (homeOutcome.kind !== 'fetched' || homeOutcome.http_status >= 400) {
    return { crawlRunId, records };
  }

  const homeObservations = homeRow.observations!;
  const homePage = await readablePage(homeOutcome, homeObservations);
  const claims = extractClaims(homePage);
  homeRow.claims = claims;
  corpus.push({ url: homeOutcome.final_url, role: 'homepage', text: homePage.text });
  for (const anchor of homePage.anchors) {
    const url = normalise(anchor.href, homeOutcome.final_url, homeUrl);
    if (url) discoveredUrls.add(url);
  }

  /* -- R2 §5.1 step 1: llms.txt ------------------------------------------- */
  const llmsUrl = new URL('/llms.txt', homeUrl).toString();
  const llmsOutcome = await fetchAndRecord(llmsUrl);
  let llmsTxt: { url: string; http_status: number; bytes: number } | null = null;
  if (llmsOutcome.kind === 'fetched') {
    const isText = (llmsOutcome.content_type ?? '').startsWith('text/') && !/^\s*</.test(llmsOutcome.body);
    llmsTxt = { url: llmsUrl, http_status: llmsOutcome.http_status, bytes: isText ? llmsOutcome.body.length : 0 };
    if (llmsOutcome.http_status === 200 && isText) {
      for (const url of parseLlmsTxt(llmsOutcome.body, llmsUrl, homeUrl)) discoveredUrls.add(url);
    }
  }

  /* -- R2 §5.1 steps 2 and 3: sitemaps ------------------------------------ */
  const declaredSitemaps = (homeOutcome.decision.robots.sitemaps as string[] | undefined) ?? [];
  const sitemapUrls = declaredSitemaps.length
    ? declaredSitemaps.slice(0, 5)
    : [new URL('/sitemap.xml', homeUrl).toString()];
  for (const sitemapUrl of sitemapUrls) {
    if (Date.now() > deadline) break;
    const outcome = await fetchAndRecord(sitemapUrl);
    if (outcome.kind !== 'fetched' || outcome.http_status !== 200) continue;
    const { locs, children } = parseSitemap(outcome.body);
    for (const loc of [...locs, ...children]) {
      const url = normalise(loc, sitemapUrl, homeUrl);
      if (url) discoveredUrls.add(url);
    }
  }

  /* -- R2 §5.1 step 4 is already covered: the homepage's own links --------- */
  const budget = homeOutcome.decision.crawl_budget;
  const alreadyRead = new Set([homeUrl, homeOutcome.final_url, llmsUrl, ...sitemapUrls]);
  const queue = prioritise(
    [...discoveredUrls].filter((url) => !alreadyRead.has(url) && !isNeverTouch(url)),
    budget.page_cap - records.length,
  );

  for (const url of queue) {
    if (Date.now() > deadline) {
      homeObservations.push({
        kind: 'crawl_wall_clock_reached',
        detail: `Stopped after ${R2_CAPS.wallClockMs} ms with ${queue.length} URL(s) still queued (R2 §5.3).`,
        value: queue.length,
      });
      break;
    }
    const outcome = await fetchAndRecord(url);
    if (outcome.kind !== 'fetched' || outcome.http_status !== 200) continue;
    const row = records.at(-1)!.evidence;
    const page = await readablePage(outcome, row.observations!);
    if (page.text.length > 0) corpus.push({ url: outcome.final_url, role: pageRole(url), text: page.text });
    for (const anchor of page.anchors) {
      const link = normalise(anchor.href, outcome.final_url, homeUrl);
      if (link) discoveredUrls.add(link);
    }
  }

  /* -- the analysis. Attached to the landing page: that is where the claims
        were made, and every observation names the URL that settled it. ----- */
  const others = corpus.filter((page) => page.url !== homeOutcome.final_url);
  const c1 = diffClaims(claims, others);
  const c2 = collectC2(corpus);
  const c3 = collectC3(corpus);
  const c4 = collectC4(corpus, { llmsTxt, discoveredUrls: [...discoveredUrls] });

  const quotes: EvidenceQuote[] = [...c1.quotes, ...c2.quotes, ...c3.quotes, ...c4.quotes];
  homeRow.quotes = quotes;
  homeObservations.push(
    {
      kind: 'corpus',
      detail: `The C1-C4 evidence below was drawn from ${corpus.length} page(s) the gate permitted: ${corpus.map((p) => p.url).join(', ')}`,
      value: corpus.length,
    },
    ...c1.observations,
    ...c2.observations,
    ...c3.observations,
    ...c4.observations,
  );

  return { crawlRunId, records };
}
