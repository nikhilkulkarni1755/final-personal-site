/**
 * Which pages of a candidate's site we ask the gate about, and in what order.
 *
 * R2 §5.1 fixes the enumeration order and this module does not deviate from it:
 *   1. /llms.txt   -- the operator's own answer to "what should a machine read"
 *   2. Sitemap: directives out of robots.txt (via the gate, which already read it)
 *   3. /sitemap.xml, only if step 2 found none
 *   4. in-page links, only if 1-3 came up short of the cap
 *
 * llms.txt is a SCOPE seed and never a permission (R2 §1.7). A site with an
 * llms.txt and a Disallow: / is still a Disallow: /, and every URL here still
 * goes through the gate one at a time.
 */

/* -------------------------------------------------------------------------- */
/* what counts as "this project's own pages"                                   */
/* -------------------------------------------------------------------------- */

/**
 * The scope of one candidate: an authority, and the path prefix inside it that
 * belongs to this project.
 *
 * D23. This lane used to scope crawls to the AUTHORITY, which is right for a
 * product that owns its domain and catastrophically wrong for a project hosted
 * under a path on a shared host. W2 sets a GitHub candidate's product_url to
 * `repo.homepage || repo.html_url`, so a repo with no homepage becomes
 * `https://github.com/owner/repo` -- and authority scoping then walked GitHub
 * Inc.'s own site and attributed it to the maker.
 *
 * What that produced, measured by V1 on github.com/affirmitv/ghosthands: 24
 * pages crawled, ONE of them the repo. A C4 score of 3 for "an MCP endpoint
 * linked from the site's own pages" was GitHub's MCP endpoint. And the only C1
 * contradiction the system produced all day was a real project's README claim
 * about a free offline tier, "contradicted" by "Start a free 30 day trial
 * today" -- scraped from github.com/pricing. Every quote was real. All of them
 * were misattributed, which tells the same lie as inventing one, and under D7
 * a contradiction is disqualifying, so it killed a real person's project on the
 * strength of a sentence written by GitHub Inc.
 *
 * The rule is deliberately generic. github.com is not special-cased and must
 * not be: the same shape is gitlab.com, huggingface.co, itch.io, notion.site,
 * a Substack, an App Store listing, and whichever host appears next -- and the
 * next one would be silent again.
 */
export interface ProjectScope {
  /** scheme://host[:port] */
  authority: string;
  /** '/' when the product owns the domain; otherwise the tenant's path. */
  prefix: string;
  /**
   * True when this product owns the whole authority, so its subdomains and
   * every path are fairly attributed to it.
   */
  ownsAuthority: boolean;
}

/** Paths that mean "the root", not "a tenant living here". */
const ROOT_PATHS = /^\/?(index|home|default)?(\.html?|\.php)?$/i;

/**
 * Where this candidate's own pages live.
 *
 * A product_url with no meaningful path owns its authority. A product_url with
 * a path is treated as a tenant under that path, which is the SAFE direction:
 * under-scoping a single-tenant site costs us evidence and produces
 * `c1_unsubstantiated`, which this lane already treats as a real and honest
 * finding. Over-scoping produces a quote from somebody else's page presented as
 * this project's, which is the failure D23 exists to prevent. Those two are not
 * symmetric and the tie goes to the quieter one.
 */
export function projectScope(productUrl: string): ProjectScope {
  const parsed = new URL(productUrl);
  const path = parsed.pathname.replace(/\/+$/, '');
  if (ROOT_PATHS.test(path)) {
    return { authority: parsed.origin, prefix: '/', ownsAuthority: true };
  }
  return { authority: parsed.origin, prefix: path, ownsAuthority: false };
}

/**
 * May a page at `url` be attributed to this candidate?
 *
 * For a tenant this is a path-prefix test against ONE authority -- no
 * subdomains, because `skills.github.com` is the landlord's too. `/owner/repo`
 * admits `/owner/repo/releases` and `/owner/repo/wiki`; it does not admit
 * `/owner` (the account, not the project) or `/pricing`.
 */
export function withinScope(url: string, scope: ProjectScope): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!isHttp(url)) return false;
  if (scope.ownsAuthority) {
    return sameRegistrableDomain(url, scope.authority);
  }
  if (parsed.origin !== scope.authority) return false;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return path === scope.prefix || path.startsWith(`${scope.prefix}/`);
}

/** R2 §5.2. A ranking heuristic, not a permission one. */
const HIGH_SIGNAL_PATHS: readonly RegExp[] = [
  /^\/$/,
  /^\/pricing\b/i,
  /^\/docs?\b/i,
  /^\/about\b/i,
  /^\/features?\b/i,
  /^\/how-it-works\b/i,
  /^\/api\b/i,
  /^\/changelog\b/i,
  /^\/faq\b/i,
  /^\/blog\b/i,
];

/**
 * Same registrable domain, approximated by the last two labels.
 *
 * There is no public-suffix list in this repo, so `bbc.co.uk` and `x.co.uk`
 * would look like one domain here. That error is in the permissive direction,
 * which is why it does not decide anything: the gate re-checks every URL and
 * R2 P1 denies anything off the candidate's real eTLD+1. This only decides
 * what is worth spending a gate decision on.
 */
export function registrableDomain(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  // An IP literal has no registrable domain; taking its last two labels turns
  // 127.0.0.1 into "0.1", which is nonsense written into an audit column.
  // IPv6 arrives bracketed and contains no dots at all.
  if (/^\[|^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  return hostname.split('.').slice(-2).join('.');
}

export function sameRegistrableDomain(url: string, candidateUrl: string): boolean {
  try {
    const a = registrableDomain(url);
    return a !== '' && a === registrableDomain(candidateUrl);
  } catch {
    return false;
  }
}

function isHttp(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Absolute, fragment-free, http(s), and on the candidate's domain. */
export function normalise(href: string, base: string, scope: ProjectScope): string | null {
  let absolute: URL;
  try {
    absolute = new URL(href, base);
  } catch {
    return null;
  }
  absolute.hash = '';
  const url = absolute.toString();
  return withinScope(url, scope) ? url : null;
}

/** Markdown link targets out of an llms.txt body. */
export function parseLlmsTxt(body: string, base: string, scope: ProjectScope): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const url = normalise(match[1]!, base, scope);
    if (url && !found.includes(url)) found.push(url);
  }
  return found;
}

/** R2 §5.2: at most 500 <loc> per file, and child sitemaps one level only. */
export function parseSitemap(xml: string): { locs: string[]; children: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const all: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) all.push(match[1]!);
  const capped = all.slice(0, 500);
  return isIndex ? { locs: [], children: capped.slice(0, 5) } : { locs: capped, children: [] };
}

function rank(url: string): number {
  const path = new URL(url).pathname;
  const index = HIGH_SIGNAL_PATHS.findIndex((pattern) => pattern.test(path));
  // Unranked pages sort after every ranked one, shallowest first: a page two
  // clicks from the nav says more about a product than one ten clicks down.
  return index === -1 ? HIGH_SIGNAL_PATHS.length + path.split('/').length : index;
}

/**
 * Order the discovered URLs so that, when the page cap bites, what we spent it
 * on is the part of the site that describes the product. R2 §5.2's list, plus
 * one blog post at most -- a blog archive is not evidence about a launch.
 */
export function prioritise(urls: readonly string[], cap: number): string[] {
  const unique = [...new Set(urls)].filter(isHttp);
  let blogSeen = 0;
  return unique
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length)
    .filter((url) => (/^\/blog\b/i.test(new URL(url).pathname) ? ++blogSeen <= 1 : true))
    .slice(0, cap);
}
