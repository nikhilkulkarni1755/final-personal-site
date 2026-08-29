/**
 * C2's novelty judge (DECISIONS D37, D38).
 *
 * D37 defines a rare problem as one of three things: mixing two common apps
 * into one, a new paradigm of thinking, or solving a new type of task. All
 * three are judgements about NOVELTY IN KIND, and three loops of hand-written
 * lexical patterns established that they cannot be read off a page by regex --
 * each attempt either missed the known true positive or admitted prose nouns as
 * evidence. So this asks a model, under constraints that keep the verdict
 * auditable.
 *
 * FOUR THINGS MAKE THIS SAFE RATHER THAN VIBES:
 *
 *  1. IT READS CLAIMS, NEVER PAGES. Input is W4's extracted claims -- verbatim
 *     assertions with a locator -- not raw HTML. Feeding it a landing page
 *     reintroduces exactly the rhetoric bias D37 exists to remove.
 *
 *  2. THE QUESTION IS INVERTED. It is not asked "is this novel", which reads
 *     marketing register and rewards the most polished page. It is asked to
 *     NAME AN EXISTING PRODUCT that already does this task. That draws on world
 *     knowledge rather than the page's rhetoric, and no amount of copywriting
 *     helps a product evade it -- a landing page cannot make Cursor stop
 *     existing.
 *
 *  3. EVERY VERDICT CITES A CLAIM, AND THE CITATION IS VERIFIED. The model must
 *     return the exact claim its judgement rests on. `bindClaim` checks that
 *     string against the claims actually supplied; a claim we did not send is a
 *     fabrication, and the whole judgement is discarded rather than scored.
 *     That is a mechanical check on one axis of hallucination, not a request to
 *     behave.
 *
 *  4. THE RUBRIC STAYS PURE. This module obtains a judgement; `scoreC2` turns a
 *     judgement into a score. Given the same judgement the score is still
 *     deterministic and reproducible. Only the acquisition is not -- see the
 *     determinism carve-out in scoreC2's header.
 *
 * WHAT THIS CANNOT DO: verify that named prior art exists. A hallucinated
 * competitor is a false disqualification wearing a citation, which is worse
 * than no citation because it looks checked. Two partial defences -- the model
 * may answer `unsure`, which scores as no-evidence rather than as established;
 * and the name it gave is persisted in the rationale where a human reads it.
 * Neither is a proof. It is the residual risk of this design and it should stay
 * written down.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { EvidenceClaim, EvidenceRow } from '../types.ts';

/**
 * Claude Opus 5, deliberately, and the reasoning is part of the audit trail.
 *
 * The dominant failure mode here is not reasoning depth -- the output is one
 * short structured verdict -- it is FACTUAL RECALL RELIABILITY. Naming prior
 * art that does not exist silently disqualifies a good find, and that failure
 * is invisible in a digest because you only ever see what survived. That is a
 * knowledge-reliability problem, which is where the more capable model earns
 * its place.
 *
 * Cost does not argue against it: at 10-20 calls a day with ~2k input and a few
 * hundred output tokens, this is cents per day either way. Choosing the weaker
 * model to save that would be trading the one thing that matters for nothing
 * that does.
 */
export const NOVELTY_MODEL = 'claude-opus-5';

const Verdict = z.object({
  form: z
    .enum(['established', 'fusion', 'new_paradigm', 'new_task', 'unsure'])
    .describe(
      'established = you can name a real existing product or long-standing category that already does this task. ' +
        'fusion = D37 form 1, it combines two established products or categories into one. ' +
        'new_paradigm = D37 form 2. new_task = D37 form 3, a task that was not previously done. ' +
        'unsure = you cannot answer confidently.',
    ),
  prior_art: z
    .string()
    .nullable()
    .describe(
      'For "established", the real existing product or category that already does this, named specifically. ' +
        'Null for every other form. Never invent a name: if you cannot name one you are confident is real, ' +
        'answer "unsure" instead.',
    ),
  claim: z
    .string()
    .describe('The single claim from the numbered list that this verdict rests on, copied EXACTLY and verbatim.'),
  reason: z.string().describe('One or two sentences. Why that claim supports that form.'),
});

export type NoveltyForm = z.infer<typeof Verdict>['form'];

/** A judgement that has been checked against the claims actually supplied. */
export interface NoveltyJudgement {
  form: NoveltyForm;
  prior_art: string | null;
  reason: string;
  /** The evidence row carrying the cited claim. Non-null by construction. */
  evidence_id: string;
  cited_claim: string;
  model: string;
}

const SYSTEM = `You judge whether a software product solves a RARE problem, where rare means novel in kind.

Three things count as novel:
  1. it mixes two common, established applications into one
  2. it is a new paradigm of thinking
  3. it solves a new type of task

Nothing else counts. In particular NARROW IS NOT NOVEL: a product serving a very
specific niche is still doing an old task if the task itself is old. A stock
tracker for one appliance model is a stock tracker.

YOUR FIRST DUTY IS TO NAME PRIOR ART. Before considering novelty, try to name a
real existing product, or a long-established category of product, that already
does this task. If you can name one, the answer is "established" and you name
it. Only if you genuinely cannot name any prior art may you judge the product
novel.

Never invent a product name. If you cannot name prior art you are confident
actually exists, and you are also not confident the product is novel, answer
"unsure".

Judge ONLY the claims given to you. Do not speculate about features not claimed.
Marketing language is not evidence: words like "revolutionary", "rethink" or
"the future of" tell you nothing and must not move your answer.

You must quote, exactly, the one claim your verdict rests on.`;

/** The claims a candidate's generation asserts, tagged with their evidence row. */
export function claimsOf(rows: readonly EvidenceRow[]): { row: EvidenceRow; claim: EvidenceClaim }[] {
  return rows.flatMap((row) => row.claims.map((claim) => ({ row, claim })));
}

/**
 * Match the model's quoted claim back to a claim we actually supplied.
 *
 * Exact match first, then a whitespace-normalised compare, because a model
 * re-quoting text may normalise spacing without changing a word. Anything
 * looser would defeat the check: a "close enough" match is how a fabricated
 * claim gets accepted.
 */
export function bindClaim(
  quoted: string,
  supplied: readonly { row: EvidenceRow; claim: EvidenceClaim }[],
): { row: EvidenceRow; claim: EvidenceClaim } | null {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    supplied.find((c) => c.claim.text === quoted) ?? supplied.find((c) => flat(c.claim.text) === flat(quoted)) ?? null
  );
}

/** D6: an absent credential is a loud stop, never a silent fallback to a pattern. */
export function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(
      'Cannot score C2: ANTHROPIC_API_KEY is not set. This is a hard stop, not a skip.\n' +
        'C2 is judged by a model under DECISIONS D38; there is no pattern fallback, because three ' +
        'measured attempts established that patterns cannot read this axis. Scoring every candidate 1 ' +
        'instead would silently ship a digest with a dead criterion, which is worse than not shipping one.',
    );
  }
}

/** The model client, or a loud failure. Constructed per run, not per candidate. */
export function noveltyClient(): Anthropic {
  requireApiKey();
  return new Anthropic();
}

/**
 * Ask for one candidate's novelty verdict.
 *
 * Returns null when the model declines, errors, or cites a claim we did not
 * send. Null means "no judgement", which scoreC2 turns into 1 -- never into 0.
 * A judgement we cannot verify must not become an accusation.
 */
export async function judgeNovelty(
  client: Anthropic,
  candidate: { name: string; tagline: string | null },
  rows: readonly EvidenceRow[],
): Promise<NoveltyJudgement | null> {
  const supplied = claimsOf(rows);
  if (supplied.length === 0) return null;

  const numbered = supplied.map((c, i) => `${i + 1}. ${c.claim.text}`).join('\n');
  const response = await client.messages.parse({
    model: NOVELTY_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    // `thinking` and `output_config.effort` are deliberately omitted: on Claude
    // Opus 5 thinking is on by default and runs adaptive, and effort defaults
    // to high, which is what this judgement wants. Sending them explicitly is
    // also rejected by the installed SDK's types (0.72.x), so omitting them is
    // both the documented default and the version-safe choice.
    output_config: { format: zodOutputFormat(Verdict) },
    messages: [
      {
        role: 'user',
        content:
          `Product: ${candidate.name}\n` +
          `Tagline: ${candidate.tagline ?? '(none)'}\n\n` +
          `Claims made by the product, verbatim:\n${numbered}\n\n` +
          'Name prior art if you can. Then give your verdict, quoting exactly the one claim it rests on.',
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed) return null;

  // The mechanical hallucination check: a claim we did not send is fabricated,
  // and the whole verdict goes with it rather than being scored on trust.
  const bound = bindClaim(parsed.claim, supplied);
  if (!bound) return null;

  return {
    form: parsed.form,
    // A form other than 'established' has no prior art by definition; drop
    // anything the model attached so a stray name cannot reach the rationale.
    prior_art: parsed.form === 'established' ? parsed.prior_art : null,
    reason: parsed.reason,
    evidence_id: bound.row.id,
    cited_claim: bound.claim.text,
    model: response.model ?? NOVELTY_MODEL,
  };
}
