import type { ProductUrlKind } from '../types.ts';

/**
 * Classifies a product URL as the candidate's own dedicated site, a listing
 * on a shared host, or unknown -- D23. A candidate whose product_url is
 * `https://github.com/owner/repo` is not wrong to store, but it is a
 * different KIND of URL than `https://outcode.lol/`: the domain also hosts
 * thousands of unrelated tenants and its own marketing pages
 * (github.com/pricing, github.com/features/copilot, ...), so a crawl scoped
 * to the domain's AUTHORITY silently attributes GitHub Inc.'s content to
 * whichever repo happens to be the candidate. D23's fabricated C1
 * contradiction (a real project's offline claim "contradicted" by
 * github.com/pricing's trial copy) came from exactly this conflation.
 *
 * This module answers one question -- "is this URL a listing on a shared
 * host, or does the candidate control the whole domain, or do we genuinely
 * not know" -- so W4/W5 can treat the three differently (path-scope the
 * crawl; discount or refuse evidence attributed from outside that path;
 * never treat 'unknown' as an endorsement). It does not decide what W4 or
 * W5 DO with the answer, and it does not change what product_url is stored
 * -- D23 asks W2 only to say what the URL actually is, not to substitute a
 * different one.
 *
 * `ProductUrlKind` itself lives in finds/types.ts (W3-owned, mirrors the
 * finds_candidates.product_url_kind CHECK constraint) -- imported here, not
 * redeclared, so this module cannot drift from the database's own enum.
 *
 * Deliberately conservative: hosts are matched by exact hostname (after
 * stripping a leading `www.`), and most rules also require a path shape
 * consistent with "this is one tenant's listing" so a dedicated site that
 * merely happens to be hosted on, say, a `*.vercel.app` subdomain -- which
 * IS the whole product, not a path under a shared marketing domain -- is
 * never misclassified. New platforms get added here as they are found live,
 * the same way D23 itself was found live rather than guessed.
 */

interface SharedHostRule {
  /** Hostnames this rule matches, already lowercase, no leading `www.`. */
  hosts: string[];
  /** True if `path` (leading slash, no query/hash) identifies one tenant's listing on this host. */
  isListingPath: (path: string) => boolean;
}

// A repo/user/owner path: /owner/repo, /owner/repo/tree/..., etc. -- but not
// bare host-level pages like /pricing or /about (single segment).
const twoSegmentPath = (path: string): boolean => /^\/[^/]+\/[^/]+/.test(path);

const SHARED_HOST_RULES: SharedHostRule[] = [
  // Code hosts -- the shape D23 was found from.
  { hosts: ['github.com'], isListingPath: twoSegmentPath },
  { hosts: ['gitlab.com'], isListingPath: twoSegmentPath },
  { hosts: ['bitbucket.org'], isListingPath: twoSegmentPath },
  { hosts: ['codeberg.org'], isListingPath: twoSegmentPath },
  { hosts: ['sourceforge.net'], isListingPath: (p) => /^\/projects\//.test(p) },
  // Model/space hosts.
  { hosts: ['huggingface.co'], isListingPath: (p) => /^\/(spaces\/)?[^/]+\/[^/]+/.test(p) },
  // Package registries -- the whole point of the page is "here is a package", not a product site.
  { hosts: ['npmjs.com'], isListingPath: (p) => /^\/package\//.test(p) },
  { hosts: ['pypi.org'], isListingPath: (p) => /^\/project\//.test(p) },
  // App stores -- the listing is Apple's/Google's page, not the developer's.
  { hosts: ['apps.apple.com'], isListingPath: () => true },
  { hosts: ['play.google.com'], isListingPath: (p) => /^\/store\/apps\//.test(p) },
  // Content platforms where the apex domain also carries the platform's own
  // marketing -- an *.substack.com or *.notion.site SUBDOMAIN is excluded
  // deliberately (that IS the tenant's whole space, not a path on a shared
  // apex), only the shared apex-domain path form counts here.
  { hosts: ['medium.com'], isListingPath: () => true },
  { hosts: ['notion.so'], isListingPath: () => true },
  { hosts: ['substack.com'], isListingPath: () => true },
  { hosts: ['itch.io'], isListingPath: twoSegmentPath },
];

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * `unknown` on a malformed URL -- NOT `dedicated`. An unparseable URL is
 * exactly the case where we have not determined anything, and `dedicated`
 * is the value that grants confidence (finds/types.ts, finds_candidates
 * migration 20260828211100). Every OTHER return here is a real
 * determination, though: a parseable URL not matching a known shared-host
 * pattern IS classified `dedicated` by elimination against an enumerated
 * list, which is a measured judgement, not a guess -- `unknown` is reserved
 * for "could not even look", not "looked and it wasn't on the list".
 */
export function classifyProductUrl(rawUrl: string): ProductUrlKind {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'unknown';
  }
  const host = normalizeHost(parsed.hostname);
  const isShared = SHARED_HOST_RULES.some(
    (rule) => rule.hosts.includes(host) && rule.isListingPath(parsed.pathname),
  );
  return isShared ? 'shared_host' : 'dedicated';
}

/** A short suffix for log lines: flags anything other than a plain dedicated site. */
export function productUrlKindTag(kind: ProductUrlKind): string {
  if (kind === 'shared_host') return ' [SHARED-HOST]';
  if (kind === 'unknown') return ' [UNCLASSIFIED-URL]';
  return '';
}
