import type { FetchedLaunch } from './connector.ts';
import { classifyProductUrl } from './hostClassifier.ts';

// Show HN via the Algolia HN Search API. Per R1 §2: no auth, no key, no
// documented rate limit at our volume (2 requests/day), and `show_hn` is a
// first-class tag -- the cheapest, highest-confidence source we have.
//
// R1 measured that ~2/3 of Show HN posts carry no `story_text` at all (only a
// title and a URL). That is fine: W4 crawls the product's own site for
// evidence anyway, so a missing description here is honest missing data, not
// something to invent (D6). A post with no `url` at all has no product site
// for W4 to crawl, so it is dropped rather than turned into a candidate whose
// product_url points at the HN thread.

const ALGOLIA_SEARCH_URL = 'https://hn.algolia.com/api/v1/search_by_date';

interface AlgoliaHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  created_at_i: number;
  [key: string]: unknown;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbPages: number;
}

/**
 * Fetches every Show HN post created after `sinceUnixSeconds`, paginating to
 * exhaustion. R1 confirmed the `>` in `numericFilters` must be percent-encoded
 * (URLSearchParams does this) -- unencoded it is a hard HTTP 400.
 */
export async function fetchShowHN(sinceUnixSeconds: number): Promise<FetchedLaunch[]> {
  const launches: FetchedLaunch[] = [];
  let page = 0;
  let nbPages = 1;

  while (page < nbPages) {
    const params = new URLSearchParams({
      tags: 'show_hn',
      numericFilters: `created_at_i>${sinceUnixSeconds}`,
      hitsPerPage: '100',
      page: String(page),
    });
    const res = await fetch(`${ALGOLIA_SEARCH_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Algolia Show HN search failed: HTTP ${res.status} on page ${page}`);
    }
    const body = (await res.json()) as AlgoliaResponse;
    nbPages = body.nbPages;

    for (const hit of body.hits) {
      if (!hit.url) continue; // no product site to crawl -- not a candidate
      launches.push({
        externalId: hit.objectID,
        sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        productUrl: hit.url,
        productUrlKind: classifyProductUrl(hit.url),
        name: hit.title.replace(/^Show HN:\s*/i, '').trim(),
        // Not available on this source (R1 §2.3): the title is the tagline.
        tagline: null,
        title: hit.title,
        authorHandle: hit.author,
        postedAt: new Date(hit.created_at_i * 1000).toISOString(),
        raw: hit,
      });
    }
    page += 1;
  }

  return launches;
}
