/**
 * Evidence for C2 (solves a rare problem), C3 (usable by any person) and
 * C4 (agentic / MCP friendly).
 *
 * Same contract as claims.ts: this collects, it does not score. Every
 * observation is something a reader could re-derive from the quoted text or
 * the recorded status code, and absence is recorded explicitly rather than
 * left as a missing row -- "we looked and found nothing" and "we never looked"
 * are different findings and W5 must be able to tell them apart.
 */

import { sentences } from './claims.ts';
import type { CorpusPage } from './claims.ts';
import type { EvidenceObservation, EvidenceQuote } from './types.ts';

export interface SignalSet {
  quotes: EvidenceQuote[];
  observations: EvidenceObservation[];
}

function quoteFor(corpus: readonly CorpusPage[], pattern: RegExp): { page: CorpusPage; sentence: string } | null {
  for (const page of corpus) {
    for (const sentence of sentences(page.text)) {
      if (pattern.test(sentence)) return { page, sentence };
    }
  }
  return null;
}

/**
 * A sentence that mentions a thing in order to say it is NOT there.
 *
 * Found on a real launch site: colrows.com says "cluster-based CLI clients were
 * retired", "Not stitched together with cron jobs and webhook handlers" and
 * "no SDK to ship in your agents". A plain keyword match reported all three as
 * the feature being advertised, which is a false statement about a real
 * company's product. It is not enough to record the quote and hope the reader
 * notices -- the observation itself must not assert what the sentence denies.
 */
const NEGATION = /\b(no|not|never|without|instead of|rather than|retired|removed|deprecated|dropped|there is no|do(es)? not)\b/i;

/**
 * Record a named signal either way. A hit carries the sentence that produced
 * it and the URL it was on; a miss says how many pages were searched, so
 * "not found" is auditable rather than assumed.
 *
 * A hit says the page MENTIONS the thing, never that it offers it. Only the
 * quote can settle that, and the quote is always attached.
 */
function record(
  into: SignalSet,
  kind: string,
  corpus: readonly CorpusPage[],
  pattern: RegExp,
  detail: string,
  /**
   * Only for signals naming a FEATURE that a page could be denying. A problem
   * statement is full of honest negation -- "there was no way to do X" is the
   * canonical shape of one -- so applying this everywhere would flag the very
   * sentences C2 exists to find.
   */
  negationAware = false,
): boolean {
  const hit = quoteFor(corpus, pattern);
  if (hit) {
    const negated = negationAware && NEGATION.test(hit.sentence);
    const resolvedKind = negated ? `${kind}_negated` : kind;
    into.quotes.push({ text: hit.sentence, locator: `${hit.page.url} (${resolvedKind})` });
    into.observations.push({
      kind: resolvedKind,
      detail: negated
        ? `${detail} -- but the sentence found on ${hit.page.url} appears to DENY it, not offer it. Read the quote.`
        : `${detail} -- the page says so on ${hit.page.url}. The quote is verbatim; it is the evidence, not this summary.`,
      value: hit.page.url,
    });
    return !negated;
  }
  into.observations.push({
    kind: `${kind}_absent`,
    detail: `${detail} -- no such statement in the ${corpus.length} page(s) we were permitted to read`,
    value: false,
  });
  return false;
}

/* -------------------------------------------------------------------------- */
/* C2 -- solves a rare problem                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A rare problem is a judgement, and W4 does not make judgements. What it can
 * do is put the two things a judgement needs in front of W5: the product's own
 * statement of the problem, and whether it positions itself against existing
 * alternatives (a crowded category names its competitors; a rare one usually
 * has nobody to name).
 */
export function collectC2(corpus: readonly CorpusPage[]): SignalSet {
  const out: SignalSet = { quotes: [], observations: [] };

  record(
    out,
    'c2_problem_statement',
    corpus,
    /\b(the problem is|we built this because|frustrat(ed|ing)|there was no way to|no tool (that|to)|painful|tired of|why we built|existing tools)\b/i,
    'The product states the problem it exists to solve',
  );

  const alternatives = new Set<string>();
  for (const page of corpus) {
    for (const match of page.text.matchAll(
      // The keyword is case-insensitive; the captured name is not. An `i`
      // flag would make [A-Z] match anything and turn every "instead of the"
      // into a named competitor.
      /\b(?:[Uu]nlike|[Ii]nstead of|[Aa]lternative to|[Rr]eplaces?|[Mm]igrat(?:e|ing) from|[Cc]ompared to|vs\.?)\s+([A-Z][A-Za-z0-9.+-]{2,24})/g,
    )) {
      alternatives.add(match[1]!);
    }
  }
  out.observations.push({
    kind: 'c2_named_alternatives',
    detail:
      alternatives.size > 0
        ? `The site positions itself against: ${[...alternatives].join(', ')}. A category with named incumbents is not a rare problem by itself, but it is the evidence either way.`
        : 'The site names no existing alternative it replaces or is unlike.',
    value: alternatives.size,
  });

  return out;
}

/* -------------------------------------------------------------------------- */
/* C3 -- usable by any person                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The barriers between a visitor and the product, each recorded as a fact
 * about the page rather than an opinion about the audience.
 */
export function collectC3(corpus: readonly CorpusPage[]): SignalSet {
  const out: SignalSet = { quotes: [], observations: [] };

  record(out, 'c3_free_tier', corpus, /\b(free tier|free plan|free forever|forever free|100% free|free to use)\b/i, 'A no-cost way to use it is advertised', true);
  record(out, 'c3_no_card_required', corpus, /\bno credit card( required| needed)?\b/i, 'Trying it does not require a payment method');
  // Not a bare "request access": a privacy page offering to let you request
  // access to your own data matched that on the first field run, which would
  // have put a false waitlist finding against a real product.
  record(
    out,
    'c3_waitlist',
    corpus,
    /\b(join the waitlist|on the waitlist|request early access|sign up to be notified|invite[- ]only)\b/i,
    'Access is gated behind a waitlist or invite',
  );
  record(
    out,
    'c3_terminal_required',
    corpus,
    /\b(npm install|npx |pnpm add|yarn add|pip install|brew install|cargo install|docker run|docker compose|git clone|curl -[a-zA-Z]*s[a-zA-Z]* [^ ]+ ?\| ?(ba)?sh)\b/i,
    'Getting started requires a terminal',
  );
  record(
    out,
    'c3_platform_restriction',
    corpus,
    /\b(macos only|mac only|windows only|linux only|requires macos|apple silicon only|chrome only|requires docker|self-host(ing)? only)\b/i,
    'Use is restricted to a specific platform or a self-hosted deployment',
  );
  record(
    out,
    'c3_own_key_required',
    corpus,
    /\b(bring your own (api )?key|byok|you(r own)? (openai|anthropic|api) key|requires an api key)\b/i,
    'The user must supply their own third-party API key',
  );

  const pricing = corpus.find((page) => page.role === 'pricing');
  out.observations.push({
    kind: 'c3_pricing_page',
    detail: pricing
      ? `A pricing page was readable at ${pricing.url}`
      : 'No pricing page was among the pages the gate permitted, so cost could not be checked',
    value: pricing?.url ?? null,
  });

  return out;
}

/* -------------------------------------------------------------------------- */
/* C4 -- agentic / MCP friendly                                                */
/* -------------------------------------------------------------------------- */

/**
 * Surfaces that agent-ready-coord's R1 §10 established are DEAD. Advertising
 * one of these is not evidence of agent-friendliness -- it is evidence of
 * having copied a 2023 blog post -- so they are recorded as a distinct
 * observation kind that must never be counted toward C4.
 */
const DEAD_STANDARDS: readonly [string, RegExp][] = [
  ['ai-plugin.json (ChatGPT plugins, shut down 2024-04-09)', /\/\.well-known\/ai-plugin\.json|chatgpt plugin/i],
  ['agents.json (Wildcard, abandoned)', /\bagents\.json\b/i],
  ['apps.txt / agents.txt (no spec, no consumer)', /\b(apps|agents)\.txt\b/i],
  ['/.well-known/mcp.json (SEP-1649 and SEP-1960 both closed)', /\/\.well-known\/mcp(\.json)?\b/i],
  ['A2A agent-card.json (says nothing about permission; 0.29% adoption)', /\/\.well-known\/agent-card\.json/i],
  ['NLWeb (out of Microsoft, expired TLS, no live endpoints)', /\bnlweb\b/i],
];

export interface C4Inputs {
  /** llms.txt as the gate returned it, if it was reachable at all. */
  llmsTxt: { url: string; http_status: number; bytes: number } | null;
  /** Every same-authority link the crawl saw, so a spec URL can be spotted. */
  discoveredUrls: readonly string[];
}

export function collectC4(corpus: readonly CorpusPage[], inputs: C4Inputs): SignalSet {
  const out: SignalSet = { quotes: [], observations: [] };

  // Measured, not claimed: this one is a status code, not a sentence.
  out.observations.push(
    inputs.llmsTxt && inputs.llmsTxt.http_status === 200
      ? {
          kind: 'c4_llms_txt',
          detail: `GET ${inputs.llmsTxt.url} returned 200 with ${inputs.llmsTxt.bytes} bytes of text. R2 §10.6 measured llms.txt on 41.3% of launch sites, so presence is a weak signal and content is the discriminating one.`,
          value: inputs.llmsTxt.bytes,
        }
      : {
          kind: 'c4_llms_txt_absent',
          detail: inputs.llmsTxt
            ? `GET ${inputs.llmsTxt.url} returned ${inputs.llmsTxt.http_status}`
            : 'llms.txt was never reachable through the gate',
          value: inputs.llmsTxt?.http_status ?? null,
        },
  );

  const specUrls = inputs.discoveredUrls.filter((url) =>
    /openapi\.(json|ya?ml)$|swagger\.(json|ya?ml)$|\/openapi\b|\/swagger\b/i.test(url),
  );
  out.observations.push({
    kind: specUrls.length ? 'c4_openapi_spec_linked' : 'c4_openapi_spec_absent',
    detail: specUrls.length
      ? `An OpenAPI/Swagger URL is linked from the site: ${specUrls.slice(0, 3).join(', ')}`
      : 'No OpenAPI or Swagger URL appeared in the sitemap, llms.txt, or the links of any page we read. W4 does not guess spec paths.',
    value: specUrls[0] ?? null,
  });

  const mcpUrls = inputs.discoveredUrls.filter((url) => /\/mcp\b|mcp-server/i.test(url));
  const mcpMentioned = record(
    out,
    'c4_mcp',
    corpus,
    /\b(mcp|model context protocol)\b/i,
    'An MCP server is advertised',
    true,
  );
  if (mcpMentioned || mcpUrls.length) {
    out.observations.push({
      kind: 'c4_mcp_endpoint_linked',
      detail: mcpUrls.length
        ? `MCP-shaped URLs linked from the site: ${mcpUrls.slice(0, 3).join(', ')}`
        : 'MCP is mentioned in prose but no MCP endpoint URL is linked anywhere we read. The mention is a claim, not a measurement.',
      value: mcpUrls[0] ?? null,
    });
  }

  record(out, 'c4_api', corpus, /\b(rest api|public api|http api|graphql api|api reference|api docs?|api endpoint)\b/i, 'A documented API is advertised', true);
  record(out, 'c4_cli', corpus, /\b(cli|command[- ]line (tool|interface)|npx |npm install -g|brew install|pip install|cargo install)\b/i, 'A CLI is advertised', true);
  record(out, 'c4_webhooks', corpus, /\bwebhooks?\b/i, 'Webhooks are advertised', true);
  record(out, 'c4_sdk', corpus, /\b(sdk|client librar(y|ies)|python package|npm package|typescript client)\b/i, 'A client SDK is advertised', true);

  const markdownDocs = inputs.discoveredUrls.filter((url) => /\.md($|\?)/i.test(url));
  if (markdownDocs.length) {
    out.observations.push({
      kind: 'c4_markdown_docs',
      detail: `Machine-readable markdown documentation is linked: ${markdownDocs.slice(0, 3).join(', ')}`,
      value: markdownDocs.length,
    });
  }

  for (const [label, pattern] of DEAD_STANDARDS) {
    const hit = quoteFor(corpus, pattern);
    const inUrl = inputs.discoveredUrls.find((url) => pattern.test(url));
    if (!hit && !inUrl) continue;
    if (hit) out.quotes.push({ text: hit.sentence, locator: `${hit.page.url} (dead standard: ${label})` });
    out.observations.push({
      kind: 'c4_dead_standard_claimed',
      detail: `The site advertises ${label}. Per agent-ready-coord R1 §10 this is a dead surface and MUST NOT count toward C4.`,
      value: hit?.page.url ?? inUrl ?? null,
    });
  }

  return out;
}
