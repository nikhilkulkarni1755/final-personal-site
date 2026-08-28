/**
 * C1 -- "what is advertised is actually true".
 *
 * This is a claims-versus-evidence diff, not a vibe (DECISIONS D7). It runs in
 * two halves and both are recorded:
 *
 *   1. extractClaims() reads the LANDING PAGE and writes down, verbatim, what
 *      the product says it does, what it says is free, and what it says is
 *      available now. That is the left-hand side.
 *   2. diffClaims() looks for each claim in the OTHER pages the gate let us
 *      read -- docs, pricing, changelog, api -- and records what it found:
 *      corroborated, contradicted, or unsubstantiated.
 *
 * `unsubstantiated` is a real and useful finding and it is NOT `contradicted`.
 * Collapsing the two would say a company lied when all we established is that
 * we could not find the page that would settle it. Nothing here scores; W5
 * scores. Everything here carries the URL it came from and a verbatim quote.
 */

import type { EvidenceClaim, EvidenceObservation, EvidenceQuote } from './types.ts';
import type { ParsedPage } from './extract.ts';

/**
 * What sort of assertion this is. Each kind has its own idea of what would
 * corroborate it and what would contradict it, which is the only reason the
 * distinction exists.
 *
 * PROPOSED ADDITION to W3's EvidenceClaim (which today is text + locator).
 * Flagged to the coordinator rather than assumed: without it the diff cannot
 * say which claim an observation refers to, and the JSONB column accepts it.
 */
export type ClaimKind = 'capability' | 'free' | 'availability' | 'open_source' | 'interface';

export interface ExtractedClaim extends EvidenceClaim {
  kind: ClaimKind;
}

const STOPWORDS = new Set([
  'that',
  'this',
  'with',
  'your',
  'from',
  'into',
  'have',
  'more',
  'than',
  'been',
  'they',
  'them',
  'will',
  'just',
  'like',
  'when',
  'what',
  'were',
  'each',
  'their',
  'about',
  'which',
  'every',
  'without',
  'using',
  'build',
  'built',
  'make',
  'made',
  'best',
  'better',
  'first',
  'never',
  'always',
  'simple',
  'simply',
  'easy',
  'easily',
  'fast',
  'faster',
  'free',
  'today',
  'here',
  'ever',
  'over',
  'only',
  'also',
  'need',
  'needs',
  'want',
  'wants',
  'work',
  'works',
]);

/** Tokens distinctive enough to hunt for on another page. */
export function keyTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9+#.-]{3,}/g) ?? []) {
    const token = raw.replace(/[.\-]+$/, '');
    if (token.length >= 4 && !STOPWORDS.has(token)) seen.add(token);
  }
  return [...seen];
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])|\s+[•·|]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 400);
}

/* -------------------------------------------------------------------------- */
/* the left-hand side: what the landing page asserts                           */
/* -------------------------------------------------------------------------- */

/** A phrase that, if present, makes the sentence an assertion of that kind. */
const KIND_MARKERS: readonly [ClaimKind, RegExp][] = [
  ['free', /\b(free forever|forever free|free tier|free plan|free to use|100% free|completely free|no credit card|free and open)\b/i],
  [
    'availability',
    /\b(available now|generally available|out now|ships? today|launch(ed|ing) today|try it now|get started (free|now|today)|download now|now live|in production)\b/i,
  ],
  ['open_source', /\b(open[- ]source|open sourced|mit licen[cs]e|apache 2|agpl|gpl-?3|self-host(ed|able|ing)?)\b/i],
  [
    'interface',
    /\b(rest api|public api|http api|graphql api|open ?api spec|mcp server|model context protocol|webhooks?|\bcli\b|\bsdk\b|command[- ]line)\b/i,
  ],
];

function classify(text: string): ClaimKind {
  for (const [kind, marker] of KIND_MARKERS) {
    if (marker.test(text)) return kind;
  }
  return 'capability';
}

function push(into: ExtractedClaim[], text: string, locator: string): void {
  const trimmed = text.trim();
  if (trimmed.length < 12 || trimmed.length > 400) return;
  if (into.some((c) => c.text === trimmed)) return;
  into.push({ text: trimmed, locator, kind: classify(trimmed) });
}

/**
 * The specific claims a landing page makes. Verbatim: every `text` here is a
 * substring of what the origin actually served, so a reader can grep for it.
 */
export function extractClaims(page: ParsedPage): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  // The hero. h1/h2 are where a launch page states what the thing is.
  for (const heading of page.headings.filter((h) => h.level <= 2).slice(0, 8)) {
    push(claims, heading.text, `h${heading.level}`);
  }
  if (page.metaDescription) push(claims, page.metaDescription, 'meta[name=description]');

  // Feature bullets.
  page.listItems.slice(0, 40).forEach((item, index) => push(claims, item, `li[${index}]`));

  // Any body sentence that plants a flag about price, availability, licence or
  // interface. Capability sentences are already covered by the headings; taking
  // every prose sentence as a claim would drown the diff in marketing filler.
  for (const sentence of sentences(page.text)) {
    if (!KIND_MARKERS.some(([, marker]) => marker.test(sentence))) continue;
    // A page whose prose carries no sentence punctuation collapses into one
    // giant "sentence" that merely contains the headings we already took.
    // Recording that as a seventh claim would diff the whole page against
    // itself, so anything already covered by a claim is skipped.
    if (claims.some((claim) => sentence.includes(claim.text))) continue;
    // A real sentence ends. An unpunctuated run of nav labels does not, and
    // the first field run showed it is otherwise indistinguishable from prose.
    if (!/[.!?]$/.test(sentence)) continue;
    push(claims, sentence, 'body');
  }

  return claims;
}

/* -------------------------------------------------------------------------- */
/* the right-hand side: corroboration or contradiction                         */
/* -------------------------------------------------------------------------- */

export interface CorpusPage {
  url: string;
  role: string;
  text: string;
}

/**
 * Phrases that flatly contradict a claim of that kind. Kept narrow on purpose:
 * a false "contradicted" is an accusation about a real company, so a marker
 * only earns its place if there is no charitable reading of it.
 */
const CONTRADICTIONS: Partial<Record<ClaimKind, RegExp>> = {
  availability: /\b(join the waitlist|on the waitlist|coming soon|request early access|not yet available|closed beta|sign up to be notified)\b/i,
  free: /\b(no free (tier|plan)|free trial ends|paid plans only|trial expires|14[- ]day (free )?trial|30[- ]day (free )?trial)\b/i,
};

function sentenceContaining(text: string, pattern: RegExp): string | null {
  for (const sentence of sentences(text)) {
    if (pattern.test(sentence)) return sentence;
  }
  const match = pattern.exec(text);
  return match ? text.slice(Math.max(0, match.index - 80), match.index + 160).trim() : null;
}

/**
 * A sentence on `page` that carries most of the claim's distinctive terms.
 *
 * Two terms alone is too loose, and the first field run showed why: a download
 * page listing "hashes" and "SHA-256" was accepted as corroboration for a claim
 * about a password hash, on the strength of two incidental words. Requiring
 * half the claim's terms makes the match mean something. It costs recall, which
 * is the right direction -- a missed corroboration is recorded as
 * unsubstantiated, while a false one is a claim we said we had checked.
 */
function corroboratingSentence(claim: ExtractedClaim, page: CorpusPage): string | null {
  const terms = keyTerms(claim.text);
  if (terms.length < 2) return null;
  const needed = Math.max(2, Math.ceil(terms.length / 2));
  let best: { sentence: string; hits: number } | null = null;
  for (const sentence of sentences(page.text)) {
    const lower = sentence.toLowerCase();
    const hits = terms.filter((term) => lower.includes(term)).length;
    if (hits >= needed && (!best || hits > best.hits)) best = { sentence, hits };
  }
  return best?.sentence ?? null;
}

export interface ClaimDiff {
  quotes: EvidenceQuote[];
  observations: EvidenceObservation[];
}

/**
 * Diff every claim against every OTHER page we were allowed to read.
 *
 * Emits one observation per claim, always, with one of three kinds:
 *   c1_corroborated    -- another page of theirs says the same thing
 *   c1_contradicted    -- another page of theirs says the opposite
 *   c1_unsubstantiated -- nothing we could read speaks to it either way
 * and a verbatim quote for the first two, carrying the URL it came from.
 */
export function diffClaims(claims: readonly ExtractedClaim[], corpus: readonly CorpusPage[]): ClaimDiff {
  const quotes: EvidenceQuote[] = [];
  const observations: EvidenceObservation[] = [];

  for (const claim of claims) {
    const contradiction = CONTRADICTIONS[claim.kind];
    let settled = false;

    if (contradiction) {
      for (const page of corpus) {
        const sentence = sentenceContaining(page.text, contradiction);
        if (!sentence) continue;
        quotes.push({ text: sentence, locator: `${page.url} (contradicts: ${claim.text})` });
        observations.push({
          kind: 'c1_contradicted',
          detail: `Claim ${JSON.stringify(claim.text)} (${claim.kind}, ${claim.locator}) is contradicted by ${page.url}`,
          value: page.url,
        });
        settled = true;
        break;
      }
    }
    if (settled) continue;

    for (const page of corpus) {
      const sentence = corroboratingSentence(claim, page);
      if (!sentence) continue;
      quotes.push({ text: sentence, locator: `${page.url} (corroborates: ${claim.text})` });
      observations.push({
        kind: 'c1_corroborated',
        detail: `Claim ${JSON.stringify(claim.text)} (${claim.kind}, ${claim.locator}) is echoed on ${page.url} (${page.role})`,
        value: page.url,
      });
      settled = true;
      break;
    }
    if (settled) continue;

    observations.push({
      kind: 'c1_unsubstantiated',
      detail:
        `Claim ${JSON.stringify(claim.text)} (${claim.kind}, ${claim.locator}) found no corroborating or ` +
        `contradicting page among the ${corpus.length} we were permitted to read. Unsubstantiated is not false.`,
      value: null,
    });
  }

  return { quotes, observations };
}
