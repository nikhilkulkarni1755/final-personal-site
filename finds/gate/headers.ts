// X-Robots-Tag response-header reader.
//
// Format (per Google's documented extension to the robots exclusion
// vocabulary): a comma-separated directive list, optionally scoped to one
// crawler with a "<product-token>: " prefix, e.g.
//   X-Robots-Tag: noindex, nofollow
//   X-Robots-Tag: googlebot: noai
// Some directives carry their own colon-delimited parameter (unavailable_after,
// max-snippet, max-image-preview, max-video-preview) -- those colons are NOT
// a UA scope, so we special-case the known parameterized directive names.
// This module only extracts directive tokens; deciding which tokens count
// as "disallow" is a policy call and lives in config.ts (see
// disallowDirectiveTokens), applied in verdict.ts. Fetching the page is the
// orchestrator's job (gate.ts) -- one GET per page serves both this and the
// meta-robots reader, rather than a separate request each.

const PARAMETERIZED_DIRECTIVES = new Set([
  'unavailable_after',
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
]);

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
      // e.g. "unavailable_after: 25 Jun 2010 15:00:00 PST" -- keep the
      // directive name, drop the parameter (irrelevant to allow/disallow).
      tokens.push(prefix);
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
