// The USE decision -- rubric §3.2: "what may we do with the bytes we now
// hold?" Computed for every ALLOWED page, never short-circuits, and NEVER
// gates the fetch itself (that already happened -- see access.ts / §0).
// Starts permissive and lets every signal subtract; no signal ever adds a
// permission back, except the §1.5 specificity rule, which is not really an
// exception (see below).

import type { UseSignal } from './config.ts';
import type { ContentSignal, ContentUsage, UseRights } from './types.ts';

export interface PageUseSignals {
  /** X-Robots-Tag directives applicable to us, e.g. ["noindex", "max-snippet:0"]. */
  headerDirectives: string[];
  /** <meta name="robots"|our-token> directives, same vocabulary. */
  metaDirectives: string[];
  /** Origin-scoped, from the matched robots.txt group (§1.5 S8). */
  contentSignal: ContentSignal | null;
  /** Origin-scoped, from the matched robots.txt group (§1.5 S9, aipref). */
  contentUsage: ContentUsage | null;
  /** Page-scoped, from response header or meta tag (§1.5 S10). tdm-policy
   * URL is not tracked in this pass -- a known gap; §6 wants it recorded
   * (never fetched, never auto-accepted) but nothing consumes it yet. */
  tdmReservation: boolean;
  robotsSourceUrl: string;
  pageUrl: string;
}

function maxSnippetChars(directives: string[]): number | null {
  for (const d of directives) {
    const m = /^max-snippet:(-?\d+)$/.exec(d);
    if (m) return Number(m[1]);
  }
  return null;
}

/** §3.2 -- computed for every ALLOWED page. */
export function computeUseRights(signals: PageUseSignals): UseRights {
  const allDirectives = [...signals.headerDirectives, ...signals.metaDirectives];
  const has = (name: string) => allDirectives.includes(name);
  const source = (name: string): UseSignal => (signals.headerDirectives.includes(name) ? 'X_ROBOTS_TAG' : 'ROBOTS_META');
  const snippetChars = maxSnippetChars(allDirectives);

  const reservedBy: UseRights['reserved_by'] = [];
  /** `restricts` names every UseRights field this one directive/signal
   * subtracted, per W3's GateUseRights type and R2 §6 -- required, not
   * decorative: it is what lets a reader see WHY a right is false without
   * re-deriving the lattice from scratch. */
  const record = (signal: UseSignal, directive: string, restricts: string[]) =>
    reservedBy.push({
      signal,
      directive,
      source_url: signal === 'CONTENT_SIGNAL' || signal === 'CONTENT_USAGE' ? signals.robotsSourceUrl : signals.pageUrl,
      restricts,
    });

  // §1.5 specificity rule: a Level-1 (per-operation) grant beats the
  // Level-2 (blanket) tdm-reservation. tdm-reservation never grants
  // anything on its own -- it only subtracts, and only where no Level-1
  // directive on the same authority has already taken a position on that
  // exact operation.
  const aiInputGranted = signals.contentSignal?.ai_input === 'yes';
  const searchGranted = signals.contentSignal?.search === 'yes' || signals.contentUsage?.search === 'y';

  let llmIngest = true;
  let publishExcerpt = true;
  let publishLink = true;
  let followLinks = true;
  let storeRawBody = true;

  if (signals.contentSignal?.ai_input === 'no') {
    llmIngest = false;
    record('CONTENT_SIGNAL', 'ai-input=no', ['llm_ingest']);
  }
  if (signals.tdmReservation && !aiInputGranted) {
    llmIngest = false;
    record('TDM_RESERVATION', 'tdm-reservation=1', ['llm_ingest']);
  }
  if (has('noai') || has('noimageai')) {
    const directive = has('noai') ? 'noai' : 'noimageai';
    llmIngest = false;
    record(source(directive), directive, ['llm_ingest']);
  }

  // "none" = noindex, nofollow (§1.4) -- one directive, three effects, so it
  // gets one record() naming all three rather than being folded silently
  // into the noindex/nofollow checks below.
  if (has('none')) {
    publishExcerpt = false;
    publishLink = false;
    followLinks = false;
    record(source('none'), 'none', ['publish_excerpt', 'publish_link', 'follow_links']);
  } else {
    if (has('noindex')) {
      publishExcerpt = false;
      publishLink = false;
      record(source('noindex'), 'noindex', ['publish_excerpt', 'publish_link']);
    }
    if (has('nofollow')) {
      followLinks = false;
      record(source('nofollow'), 'nofollow', ['follow_links']);
    }
  }
  if (has('nosnippet')) {
    publishExcerpt = false;
    record(source('nosnippet'), 'nosnippet', ['publish_excerpt']);
  }
  if (snippetChars === 0) {
    publishExcerpt = false;
    record(source('max-snippet:0'), 'max-snippet:0', ['publish_excerpt']);
  }
  if (has('noarchive')) {
    storeRawBody = false;
    record(source('noarchive'), 'noarchive', ['store_raw_body']);
  }

  if (signals.contentSignal?.search === 'no') {
    publishExcerpt = false;
    publishLink = false;
    record('CONTENT_SIGNAL', 'search=no', ['publish_excerpt', 'publish_link']);
  }
  if (signals.contentUsage?.search === 'n') {
    publishExcerpt = false;
    publishLink = false;
    record('CONTENT_USAGE', 'search=n', ['publish_excerpt', 'publish_link']);
  }
  if (signals.tdmReservation && !searchGranted) {
    // §3.2's pseudocode applies this term to publish_excerpt only, not
    // publish_link -- not an oversight, matched here deliberately.
    publishExcerpt = false;
    record('TDM_RESERVATION', 'tdm-reservation=1', ['publish_excerpt']);
  }

  return {
    llm_ingest: llmIngest,
    publish_excerpt: publishExcerpt,
    publish_link: publishLink,
    follow_links: followLinks,
    store_raw_body: storeRawBody,
    train: false,
    max_snippet_chars: snippetChars === -1 ? null : snippetChars,
    reserved_by: reservedBy,
  };
}
