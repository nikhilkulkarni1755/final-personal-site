import type { FetchedLaunch } from './connector.ts';
import { classifyProductUrl } from './hostClassifier.ts';

// GitHub repo search. Per R1 sec.4: not a launch-announcement feed like the
// others, but "what got built and noticed this week" -- strong specifically
// for criterion C4 (agentic/MCP friendly), since GitHub's own topic taxonomy
// lets us filter directly on it.
//
// `created:` (repo creation date), not `pushed:`, is what surfaces genuinely
// new projects -- `pushed:` mostly returns old famous repos that got a commit
// today (R1 sec.4.2). `archived:false fork:false` are applied server-side so
// we never turn a fork or a dead repo into a candidate. GITHUB_TOKEN is read
// from the environment: under D0 the pipeline runs on GitHub Actions, where
// it is injected automatically, so this needs no new secret.
//
// The search API caps at 1000 results per query (a real 422 past that, R1
// measured it live) -- comfortably above our volume (67/day at stars:>25).

const SEARCH_URL = 'https://api.github.com/search/repositories';
const MIN_STARS = Number(process.env.GITHUB_MIN_STARS ?? 25);
const PER_PAGE = 100;
const MAX_PAGES = 10; // 1000-result ceiling / PER_PAGE

interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  created_at: string;
  owner: { login: string };
  [key: string]: unknown;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubRepo[];
}

function readToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'Cannot search GitHub: GITHUB_TOKEN is not set. This is a hard stop, not a ' +
        'skip -- GitHub Actions injects this automatically; set it locally ' +
        '(e.g. `export GITHUB_TOKEN=$(gh auth token)`) to run this connector by hand.',
    );
  }
  return token;
}

/** `YYYY-MM-DD` for `sinceUtc`, in UTC -- the granularity GitHub's `created:` qualifier takes. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetches repos created on or after `sinceUtc` with at least `MIN_STARS`
 * stars, excluding forks and archived repos. Paginates to `total_count`
 * (capped at GitHub's 1000-result ceiling).
 */
export async function fetchNewGithubRepos(sinceUtc: Date): Promise<FetchedLaunch[]> {
  const token = readToken();
  const query = `created:>=${isoDate(sinceUtc)} stars:>${MIN_STARS} archived:false fork:false`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'interesting-finds-ingest',
  };

  const launches: FetchedLaunch[] = [];
  let page = 1;
  let totalCount = Infinity;

  while ((page - 1) * PER_PAGE < totalCount && page <= MAX_PAGES) {
    const params = new URLSearchParams({
      q: query,
      sort: 'stars',
      order: 'desc',
      per_page: String(PER_PAGE),
      page: String(page),
    });
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, { headers });
    if (!res.ok) {
      throw new Error(`GitHub search failed: HTTP ${res.status} on page ${page}`);
    }
    const body = (await res.json()) as GitHubSearchResponse;
    totalCount = body.total_count;

    for (const repo of body.items) {
      // D23: when there is no homepage, productUrl falls back to the repo
      // page itself -- correct (it is still the best URL we have) but a
      // DIFFERENT KIND of URL than a dedicated site, since github.com also
      // hosts its own marketing pages under the same authority. Measured
      // live (2026-08-28): 55/69 repos in a 24h window had no homepage, so
      // this is the majority case for this source, not an edge case.
      const productUrl = repo.homepage?.trim() || repo.html_url;
      launches.push({
        externalId: String(repo.id),
        sourceUrl: repo.html_url,
        productUrl,
        productUrlKind: classifyProductUrl(productUrl),
        name: repo.full_name,
        tagline: repo.description,
        title: repo.full_name,
        authorHandle: repo.owner.login,
        postedAt: repo.created_at,
        raw: repo,
      });
    }
    page += 1;
  }

  return launches;
}
