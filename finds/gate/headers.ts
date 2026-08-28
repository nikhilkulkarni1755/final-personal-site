// Page-level response-header readers: X-Robots-Tag (§1.4), tdm-reservation /
// tdm-policy (§1.5 S10), and Content-Usage (§1.5 S9). All are pure parsers
// -- fetching the page is the orchestrator's job (gate.ts), which shares one
// GET per page across this, meta-robots, and the sitemap/body reads.
//
// X-Robots-Tag format (per Google's documented extension to the robots
// exclusion vocabulary): a comma-separated directive list, optionally
// scoped to one crawler with a "<product-token>: " prefix, e.g.
//   X-Robots-Tag: noindex, nofollow
//   X-Robots-Tag: googlebot: noai
// Some directives carry their own colon-delimited parameter (unavailable_after,
// max-snippet, max-image-preview, max-video-preview) -- those colons are NOT
// a UA scope, so we special-case the known parameterized directive names.
// max-snippet's numeric value is kept (needed for the USE lattice's
// max_snippet_chars, §3.2); the others' values are dropped as policy-irrelevant.
// This module only extracts directive tokens; deciding what they mean for
// FETCH vs USE is §3.1/§3.2's job, applied in access.ts/use.ts.

import type { ContentUsage } from './types.ts';

const PARAMETERIZED_DIRECTIVES = new Set([
  'unavailable_after',
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
]);
const VALUE_RELEVANT_DIRECTIVES = new Set(['max-snippet']);

/**
 * Extract the directive tokens from a raw X-Robots-Tag value that apply to
 * our own user agent: unscoped tokens, plus any scoped to our product token.
 */
export function extractApplicableDirectives(
  rawHeaderValue: string,
  productToken: string,
): string[] {
  const token = productToken.toLowerCase();
  const tokens: string[] = [];

  for (const chunk of rawHeaderValue.split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      tokens.push(trimmed.toLowerCase());
      continue;
    }

    const prefix = trimmed.slice(0, colonIdx).trim().toLowerCase();
    if (PARAMETERIZED_DIRECTIVES.has(prefix)) {
      if (VALUE_RELEVANT_DIRECTIVES.has(prefix)) {
        const val = trimmed.slice(colonIdx + 1).trim();
        tokens.push(`${prefix}:${val}`);
      } else {
        // e.g. "unavailable_after: 25 Jun 2010 15:00:00 PST" -- keep the
        // directive name, drop the parameter (irrelevant to our USE lattice).
        tokens.push(prefix);
      }
      continue;
    }

    // Otherwise the prefix is a UA scope; only keep it if it's ours.
    if (prefix === token) {
      const rest = trimmed.slice(colonIdx + 1).trim().toLowerCase();
      if (rest) tokens.push(rest);
    }
  }

  return tokens;
}

/** §1.5 S10 -- "tdm-reservation: 1" response header. Anything other than the
 * literal "1" is a protocol error; the spec says to treat it as unset. */
export function parseTdmReservationHeader(rawValue: string | null): boolean {
  return rawValue !== null && rawValue.trim() === '1';
}

/** §1.5 S9 (aipref) response-header form: "Content-Usage: train-ai=n". */
export function parseContentUsageHeader(rawValue: string | null): ContentUsage | null {
  if (!rawValue) return null;
  const out: ContentUsage = {};
  for (const pair of rawValue.trim().split(/\s+/)) {
    const [rawKey, rawVal] = pair.split('=').map((s) => s.trim().toLowerCase());
    if (!rawKey || (rawVal !== 'y' && rawVal !== 'n')) continue;
    if (rawKey === 'train-ai') out.train_ai = rawVal;
    else if (rawKey === 'search') out.search = rawVal;
  }
  return Object.keys(out).length > 0 ? out : null;
}
