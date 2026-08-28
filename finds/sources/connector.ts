import type { SourceAuthKind } from '../types.ts';
import type { ProductUrlKind } from './hostClassifier.ts';

/**
 * Shapes local to the ingest lane -- how a connector talks about what it
 * fetched, before that gets turned into a NewCandidate/NewCandidateSighting
 * pair (finds/types.ts, W3-owned). These describe the FETCH, not a table, so
 * they live here rather than being proposed into finds/types.ts.
 */

/** Registration row for a source. Passed to ensureSource() in health.ts. */
export interface SourceDefinition {
  slug: string;
  displayName: string;
  homepageUrl: string;
  authKind: SourceAuthKind;
  /** Defaults to the column default (36h) if omitted. */
  stalenessBudgetHours?: number;
}

/**
 * One product launch as a connector reports it, before dedupe. `productUrl`
 * is the product's own site (what W1 gates and W4 crawls); `sourceUrl` is the
 * listing page on the platform (what W9 comments on). A connector that finds
 * no product URL for a listing must drop it rather than substitute the
 * listing URL -- there is nothing for W4 to crawl otherwise (see hn.ts).
 */
export interface FetchedLaunch {
  /** The platform's own id for this listing. Unique within the source. */
  externalId: string;
  sourceUrl: string;
  productUrl: string;
  /**
   * Whether productUrl is the candidate's own dedicated site or a listing on
   * a shared host (github.com/owner/repo and the like) -- D23. Every
   * connector must set this via classifyProductUrl(); it is NOT yet written
   * to finds_candidates (no column exists there yet -- proposed to the
   * coordinator, see DEPENDENCIES.md LIVE), but it is computed here and
   * logged by every run-*.ts so the signal exists the moment W3 adds it,
   * and so it is visible in the meantime rather than silently absent.
   */
  productUrlKind: ProductUrlKind;
  name: string;
  tagline: string | null;
  title: string | null;
  authorHandle: string | null;
  /** ISO 8601, or null if the source does not report one. */
  postedAt: string | null;
  /** The source's response for this item, verbatim. Never edited. */
  raw: Record<string, unknown>;
}
