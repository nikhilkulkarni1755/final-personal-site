/**
 * Turning a fetched page into the few structured pieces the C1-C4 collectors
 * need: what it says, where it said it, and what it links to.
 *
 * Regex rather than a DOM parser, deliberately. The site has no HTML-parsing
 * dependency today and this lane needs five things out of a document -- title,
 * meta description, headings, list items and anchors. Adding cheerio to a repo
 * that ships a Vite front end to buy those five is not worth the supply chain.
 * Where the regex is wrong it is wrong in the direction of extracting less,
 * which costs a quote, never a false one: every quote is a substring of the
 * bytes we actually received.
 */

import type { EvidencePageRole } from './types.ts';

const BLOCK_ELEMENTS = /<\/?(p|div|section|article|header|footer|li|tr|h[1-6]|br)\b[^>]*>/gi;
const STRIPPED_ELEMENTS = /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key]!;
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
    return whole;
  });
}

/** Tags out, entities decoded, whitespace collapsed. Block tags become spaces. */
export function toText(html: string): string {
  return decodeEntities(
    html.replace(STRIPPED_ELEMENTS, ' ').replace(BLOCK_ELEMENTS, ' ').replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Heading {
  level: number;
  text: string;
}

export interface Anchor {
  href: string;
  text: string;
}

export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  headings: Heading[];
  listItems: string[];
  anchors: Anchor[];
  /** Whole-document visible text, collapsed. */
  text: string;
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[1] ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() || null : null;
}

export function parsePage(html: string): ParsedPage {
  const body = html.replace(STRIPPED_ELEMENTS, ' ');

  const headings: Heading[] = [];
  for (const match of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = toText(match[2]!);
    if (text) headings.push({ level: Number(match[1]), text });
  }

  const listItems: string[] = [];
  for (const match of body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = toText(match[1]!);
    if (text) listItems.push(text);
  }

  const anchors: Anchor[] = [];
  for (const match of body.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    anchors.push({ href: decodeEntities(match[1]!), text: toText(match[2]!) });
  }

  return {
    title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    metaDescription:
      firstMatch(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ??
      firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i),
    headings,
    listItems,
    anchors,
    text: toText(body),
  };
}

/**
 * A JS-rendered SPA answers a plain GET with a shell. R2 §3.6 says rendering
 * it is allowed -- "rendering is not a permission question" -- so this is only
 * ever a signal about whether to spend a browser on the page.
 */
export function looksLikeEmptyShell(page: ParsedPage): boolean {
  return page.text.length < 200 && page.headings.length === 0;
}

/* -------------------------------------------------------------------------- */
/* page roles                                                                  */
/* -------------------------------------------------------------------------- */

/** Ordered: the first pattern that matches the path wins. */
const ROLE_PATTERNS: readonly [RegExp, EvidencePageRole][] = [
  [/^\/robots\.txt$/i, 'robots_txt'],
  [/^\/llms(-full)?\.txt$/i, 'llms_txt'],
  [/^\/(pricing|plans|price)\b/i, 'pricing'],
  [/^\/(changelog|releases?|whats-new|release-notes)\b/i, 'changelog'],
  [/^\/(about|team|company)\b/i, 'about'],
  [/^\/(blog|posts?|news|articles?)\b/i, 'blog'],
  [/\bmcp\b/i, 'mcp'],
  [/^\/(api|openapi|swagger|reference)\b|openapi\.(json|ya?ml)$|swagger\.json$/i, 'api'],
  [/^\/(docs?|documentation|guide|developers?|manual)\b/i, 'docs'],
];

/** What this page is to us, so scoring can ask for the pricing page directly. */
export function pageRole(url: string): EvidencePageRole {
  const parsed = new URL(url);
  if (/^(www\.)?github\.com$/i.test(parsed.hostname) || /^(www\.)?gitlab\.com$/i.test(parsed.hostname)) {
    return 'repo';
  }
  const path = parsed.pathname;
  if (path === '/' || path === '') return 'homepage';
  for (const [pattern, role] of ROLE_PATTERNS) {
    if (pattern.test(path)) return role;
  }
  return 'other';
}
