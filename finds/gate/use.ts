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

function hasDirective(directives: string[], name: string): boolean {
  return directives.includes(name);
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
  const noneOrIndexIsh = hasDirective(allDirectives, 'none');
  const noindex = hasDirective(allDirectives, 'noindex') || noneOrIndexIsh;
  const nofollow = hasDirective(allDirectives, 'nofollow') || noneOrIndexIsh;
  const nosnippet = hasDirective(allDirectives, 'nosnippet');
  const noarchive = hasDirective(allDirectives, 'noarchive');
  const noai = hasDirective(allDirectives, 'noai') || hasDirective(allDirectives, 'noimageai');
  const snippetChars = maxSnippetChars(allDirectives);

  const reservedBy: UseRights['reserved_by'] = [];
  const record = (signal: UseSignal, directive: string) =>
    reservedBy.push({ signal, directive, source_url: signal === 'CONTENT_SIGNAL' || signal === 'CONTENT_USAGE' ? signals.robotsSourceUrl : signals.pageUrl });

  // §1.5 specificity rule: a Level-1 (per-operation) grant beats the
  // Level-2 (blanket) tdm-reservation. tdm-reservation never grants
  // anything on its own -- it only subtracts, and only where no Level-1
  // directive on the same authority has already taken a position on that
  // exact operation.
  const aiInputGranted = signals.contentSignal?.ai_input === 'yes';
  const searchGranted = signals.contentSignal?.search === 'yes' || signals.contentUsage?.search === 'y';

  let llmIngest = true;
  if (signals.contentSignal?.ai_input === 'no') {
    llmIngest = false;
    record('CONTENT_SIGNAL', 'ai-input=no');
  }
  if (signals.tdmReservation && !aiInputGranted) {
    llmIngest = false;
    record('TDM_RESERVATION', 'tdm-reservation=1');
  }
  if (noai) {
    llmIngest = false;
    record(hasDirective(signals.headerDirectives, 'noai') || hasDirective(signals.headerDirectives, 'noimageai') ? 'X_ROBOTS_TAG' : 'ROBOTS_META', 'noai/noimageai');
  }

  let publishExcerpt = true;
  if (noindex || nosnippet || noneOrIndexIsh || snippetChars === 0) {
    publishExcerpt = false;
    record(hasDirective(signals.headerDirectives, 'noindex') || hasDirective(signals.headerDirectives, 'nosnippet') || hasDirective(signals.headerDirectives, 'none') ? 'X_ROBOTS_TAG' : 'ROBOTS_META', noindex ? 'noindex' : nosnippet ? 'nosnippet' : snippetChars === 0 ? 'max-snippet:0' : 'none');
  }
  if (signals.contentSignal?.search === 'no') {
    publishExcerpt = false;
    record('CONTENT_SIGNAL', 'search=no');
  }
  if (signals.contentUsage?.search === 'n') {
    publishExcerpt = false;
    record('CONTENT_USAGE', 'search=n');
  }
  if (signals.tdmReservation && !searchGranted) {
    publishExcerpt = false;
    record('TDM_RESERVATION', 'tdm-reservation=1');
  }

  let publishLink = true;
  if (noindex || noneOrIndexIsh) {
    publishLink = false;
    record(hasDirective(signals.headerDirectives, 'noindex') || hasDirective(signals.headerDirectives, 'none') ? 'X_ROBOTS_TAG' : 'ROBOTS_META', noindex ? 'noindex' : 'none');
  }
  if (signals.contentSignal?.search === 'no') publishLink = false;
  if (signals.contentUsage?.search === 'n') publishLink = false;

  return {
    llm_ingest: llmIngest,
    publish_excerpt: publishExcerpt,
    publish_link: publishLink,
    follow_links: !nofollow,
    store_raw_body: !noarchive,
    train: false,
    max_snippet_chars: snippetChars === -1 ? null : snippetChars,
    reserved_by: reservedBy,
  };
}
