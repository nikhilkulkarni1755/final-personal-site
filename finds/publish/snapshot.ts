/**
 * Turn the private pipeline rows for one candidate into the public row.
 *
 * PURE ON PURPOSE. Every rule that can refuse a publish lives here and none of
 * them needs a database, a credential or a network. That is what makes them
 * testable, and this is the one lane whose bugs are visible to the public
 * internet under Nikhil's name.
 *
 * WHY A SNAPSHOT AND NOT A VIEW (W3's migration says this too, and it is worth
 * restating where the copying actually happens): the browser holds the anon
 * key, so a join to candidates/evidence/verdicts would either leak the private
 * pipeline or need a view that reads past RLS. It is also the honest editorial
 * model -- a published find is what Nikhil approved on the day he approved it,
 * and a later re-crawl must not silently rewrite a page carrying his name.
 *
 * THE FIVE REFUSALS, in the order they matter:
 *   1. no approval from Nikhil          -> approval.ts, throws
 *   2. evidence from outside the        -> scope.ts (DECISIONS D23)
 *      candidate's own subtree
 *   3. a quote or link the site's USE   -> R2's ACCESS/USE split; W11 is the
 *      signals forbid publishing           only lane that can honour it
 *   4. a score with no publishable      -> DECISIONS D7, which does not stop
 *      evidence behind it                  applying because the score went public
 *   5. a slug that is not stable/unique -> a find's URL is what a maker links back to
 */

import type { Criterion, VerdictScore } from '../types.ts';
import { assertApprovedByNikhil, type FindApproval } from './approval.ts';
import { describeScope, isWithinScope, publishScopeFor } from './scope.ts';
import type { CandidateCitation, NewPublishedFind, PublishSource } from './types.ts';

const CRITERIA: Criterion[] = ['C1', 'C2', 'C3', 'C4'];

/** Mirrors finds_published_slug_check. Asserted here so a bad slug is a named
 *  refusal rather than a Postgres constraint violation at the last moment. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface PublishOptions {
  approval: FindApproval;
  /**
   * The visibility switch. `null` drafts it, a future ISO timestamp schedules
   * it, and either way anon cannot read the row until the time passes. There is
   * no status column and none is needed.
   */
  published_at: string | null;
  /** Overrides the slug derived from the name. Required when they collide. */
  slug?: string;
  /** Slugs already taken in finds_published. A collision refuses, never renames. */
  taken_slugs?: string[];
}

export type SnapshotResult =
  | { ok: true; row: NewPublishedFind; notes: string[] }
  | { ok: false; refusals: string[] };

/**
 * A find's URL is the thing a maker links back to, so it is derived from the
 * product's name and then left alone. Nothing here appends a counter: two
 * products with the same name refuse and ask for an explicit slug, because a
 * silently renamed `-2` is a URL nobody can predict or keep.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildSnapshot(source: PublishSource, options: PublishOptions): SnapshotResult {
  // Not a refusal: a publish reached without Nikhil's approval is a wiring
  // fault, and it must be impossible to collect it alongside data problems and
  // then look past it.
  assertApprovedByNikhil(options.approval, source.candidate.id);

  const refusals: string[] = [];
  const notes: string[] = [];

  const scope = publishScopeFor(source.candidate.product_url);

  /* --- the scores ------------------------------------------------------- */
  const scoreOf = new Map<Criterion, VerdictScore>();
  for (const s of source.scores) scoreOf.set(s.criterion, s.score);
  const missing = CRITERIA.filter((c) => !scoreOf.has(c));
  if (missing.length > 0) {
    refusals.push(
      `no score for ${missing.join(', ')} on crawl generation ${source.evidence_run_id}. ` +
        `The page shows all four criteria, so publishing with one unscored would show a ` +
        `number nobody produced.`,
    );
  }

  /* --- the citations ---------------------------------------------------- */
  const publishable: CandidateCitation[] = [];
  for (const citation of source.citations) {
    if (!isWithinScope(citation.url, scope)) {
      // DECISIONS D23. This is the case that already produced a false public
      // accusation once, so it refuses the whole publish rather than dropping
      // the citation quietly: if the crawl wandered off the product, every
      // score it produced is suspect, not just this one line.
      refusals.push(
        `citation for ${citation.criterion} quotes ${citation.url}, which is outside ` +
          `${describeScope(scope)} -- the only thing ${source.candidate.name} controls. ` +
          `Evidence from an origin the candidate does not own cannot be attributed to it ` +
          `(DECISIONS D23).`,
      );
      continue;
    }
    const rights = citation.use_rights;
    if (!rights || !('publish_link' in rights)) {
      refusals.push(
        `citation for ${citation.criterion} (${citation.url}) carries no recorded USE rights, ` +
          `so there is no evidence we may republish it. Refusing rather than assuming permission.`,
      );
      continue;
    }
    if (!rights.publish_link) {
      notes.push(`dropped ${citation.url}: the site's signals refuse a public link to it`);
      continue;
    }
    let quote = citation.quote;
    if (quote !== undefined && !rights.publish_excerpt) {
      notes.push(`dropped the quote from ${citation.url}: its signals refuse a public excerpt`);
      quote = undefined;
    }
    if (quote !== undefined && rights.max_snippet_chars !== null && quote.length > rights.max_snippet_chars) {
      // Never truncate. A shortened quote is a misquote, and this page's whole
      // pitch is that the evidence is real.
      notes.push(
        `dropped the quote from ${citation.url}: ${quote.length} chars exceeds the ` +
          `${rights.max_snippet_chars}-char snippet limit its signals set, and a trimmed quote is a misquote`,
      );
      quote = undefined;
    }
    publishable.push({ ...citation, quote, use_rights: rights });
  }

  // D7 does not stop applying because the score went public.
  for (const criterion of CRITERIA) {
    if (!scoreOf.has(criterion)) continue;
    if (!publishable.some((c) => c.criterion === criterion)) {
      refusals.push(
        `${criterion} would be published with no evidence a reader can check. ` +
          `A find on that page makes claims about someone else's product; every score must be traceable (DECISIONS D7).`,
      );
    }
  }

  /* --- identity --------------------------------------------------------- */
  const slug = options.slug ?? slugify(source.candidate.name);
  if (!SLUG_PATTERN.test(slug)) {
    refusals.push(
      `${JSON.stringify(slug)} is not a usable URL segment for /interesting-finds/. ` +
        `Pass an explicit slug.`,
    );
  } else if ((options.taken_slugs ?? []).includes(slug)) {
    refusals.push(
      `the slug ${JSON.stringify(slug)} is already published. Pass an explicit slug -- ` +
        `a find's URL is what a maker links back to, so nothing here renames one behind your back.`,
    );
  }

  if (source.source_labels.length === 0) {
    refusals.push('no source label: we cannot say where this launch was seen.');
  }

  if (refusals.length > 0) return { ok: false, refusals };

  return {
    ok: true,
    notes,
    row: {
      candidate_id: source.candidate.id,
      slug,
      name: source.candidate.name,
      tagline: source.candidate.tagline,
      product_url: source.candidate.product_url,
      source_labels: source.source_labels,
      found_at: source.candidate.first_seen_at,
      published_at: options.published_at,
      score_claim_verified: scoreOf.get('C1') as VerdictScore,
      score_rare_problem: scoreOf.get('C2') as VerdictScore,
      score_anyone_can_use: scoreOf.get('C3') as VerdictScore,
      score_agentic_friendly: scoreOf.get('C4') as VerdictScore,
      citations: publishable.map(({ criterion, url, quote, stance }) =>
        quote === undefined ? { criterion, url, stance } : { criterion, url, quote, stance },
      ),
      // Per D4 the system never authors prose in his name, so this is his text
      // or nothing. There is no fallback to a generated sentence.
      why_interesting: options.approval.why_interesting ?? null,
    },
  };
}
