/**
 * What the candidate actually controls -- the D23 defence, on the publish side.
 *
 * DECISIONS D23: the crawler scopes to the AUTHORITY. That is right for a
 * project on its own domain and wrong for a project living under a path on a
 * shared host. V1 measured 45% of one day's candidates pointing at
 * github.com/owner/repo, and the system recorded a real project's README claim
 * as CONTRADICTED by a sentence on github.com/pricing -- a fabricated
 * accusation against a named third party, generated from a page GitHub Inc.
 * wrote. Nothing in the pipeline noticed.
 *
 * W4 must fix that upstream. This is the second lock, and it belongs here
 * specifically: a wrong score is an internal error until it is published, at
 * which point it is a public statement on Nikhil's personal domain under his
 * name. So the publish path does not assume its inputs are clean. It re-derives
 * the scope from `product_url` and refuses any citation from outside it.
 *
 * The rule is generic, not a github.com special case, because the shape recurs:
 * gitlab.com/..., huggingface.co/..., itch.io/..., a notion.site, a Substack,
 * an App Store listing.
 *
 *   product_url has NO path      -> the candidate holds the whole authority
 *   product_url has a path       -> the candidate holds that subtree, nothing else
 *
 * The second case is deliberately strict, and it costs real publishes: a
 * project on its own domain whose product_url happens to carry a path
 * (`https://example.com/product`) cannot cite `https://example.com/docs`. That
 * refusal is loud, names the URLs, and is fixable by correcting product_url.
 * The opposite error -- attributing a shared host's words to its tenant -- is
 * the one that already happened, in a real run, to a real person's project.
 */

/** The subtree of the web a candidate is taken to speak for. */
export interface PublishScope {
  /** Host and port, `www.` stripped. Scheme is deliberately not compared. */
  host: string;
  /** '/' for a whole authority, else '/owner/repo/'. Always ends in '/'. */
  pathPrefix: string;
  /** True when product_url is a bare origin, so the whole host is in scope. */
  wholeAuthority: boolean;
}

/**
 * `www.` is stripped because finds_normalize_url already treats
 * www.example.com and example.com as one candidate; comparing them as
 * different hosts here would refuse a citation the pipeline deliberately
 * deduped. Scheme is not compared: http and https on one host are the same
 * owner, and a crawl that followed an http -> https redirect records the
 * final URL.
 */
function hostKey(url: URL): string {
  return url.host.replace(/^www\./, '');
}

/** Throws on anything that is not an http(s) URL -- a publish must not guess. */
function parse(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${what} is not a URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${what} is not http(s): ${raw}`);
  }
  return url;
}

export function publishScopeFor(productUrl: string): PublishScope {
  const url = parse(productUrl, 'product_url');
  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  return {
    host: hostKey(url),
    pathPrefix: segments.length === 0 ? '/' : `/${segments.join('/')}/`,
    wholeAuthority: segments.length === 0,
  };
}

/**
 * Is this URL something the candidate speaks for?
 *
 * Query and fragment are ignored -- they cannot move a page outside the
 * subtree that serves it.
 */
export function isWithinScope(rawUrl: string, scope: PublishScope): boolean {
  let url: URL;
  try {
    url = parse(rawUrl, 'citation url');
  } catch {
    return false; // an unparseable citation is out of scope by definition
  }
  if (hostKey(url) !== scope.host) return false;
  if (scope.wholeAuthority) return true;
  const exact = scope.pathPrefix.slice(0, -1);
  return url.pathname === exact || url.pathname.startsWith(scope.pathPrefix);
}

/** Human-readable, for a refusal message that has to be actionable. */
export function describeScope(scope: PublishScope): string {
  return scope.wholeAuthority ? `all of ${scope.host}` : `${scope.host}${scope.pathPrefix}`;
}
