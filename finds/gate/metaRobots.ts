// HTML <meta name="robots" content="..."> reader.
//
// Unlike X-Robots-Tag, the meta tag's `name` attribute IS the scoping
// mechanism (name="robots" applies to everyone, name="<product-token>"
// applies only to that crawler) -- there is no colon-scoping inside
// `content` to worry about, so this is a simpler extraction than headers.ts.
//
// Deliberately regex-based rather than a full HTML parser/DOM: we only need
// one well-known void element out of the document, robots.txt-adjacent
// parsing doesn't warrant a new dependency (see lane brief: prefer zero new
// deps), and this only ever reads static HTML fetched via plain fetch, never
// a JS-rendered page.

const META_TAG_RE = /<meta\b[^>]*>/gi;

function getAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = re.exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Extract robots directive tokens from all <meta name="robots" ...> (or
 * name="<productToken>") tags in an HTML document, applicable to us.
 */
export function extractMetaRobotsDirectives(html: string, productToken: string): string[] {
  const token = productToken.toLowerCase();
  const tokens: string[] = [];

  for (const [tag] of html.matchAll(META_TAG_RE)) {
    const name = getAttr(tag, 'name')?.toLowerCase();
    if (name !== 'robots' && name !== token) continue;
    const content = getAttr(tag, 'content');
    if (!content) continue;
    for (const part of content.split(',')) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) tokens.push(trimmed);
    }
  }

  return tokens;
}
