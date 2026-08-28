/**
 * The handoff to the send: W5's selection, in the shape W6's `DigestInput`
 * declares, written to the file W10's daily runner passes to
 * `finds/email/send.ts`.
 *
 * ONE LOSSY CONVERSION, AND IT IS FLAGGED, NOT HIDDEN. `EmailCriterion.verdict`
 * is a BOOLEAN. A boolean cannot tell "the evidence contradicts this" from "we
 * found no evidence either way" -- the two cases that matter most in a digest
 * whose whole pitch is that the checks are real. It is D8's flattening one
 * layer over, and W3 already made the argument when `finds_published` chose
 * SMALLINT 0-3 over booleans.
 *
 * Two things keep that from doing damage today:
 *
 *   1. Selection disqualifies a 0 on ANY criterion, so a CONTRADICTED finding
 *      can never reach the digest at all. The only distinction the boolean
 *      still destroys is 1 (no evidence) versus 2-3 (supported).
 *   2. Every criterion scoring 1 has its evidence line OPEN with "NO EVIDENCE
 *      EITHER WAY -- this is not a failed check", so the row explains itself
 *      even under W6's red cross. A reader is told the truth in words even
 *      where the mark is lossy.
 *
 * And the fix travels in the file: each criterion carries `score`, `status`
 * and `rubric_version` ALONGSIDE `verdict`. They are extra JSON fields, which
 * W6's `JSON.parse(...) as DigestInput` ignores today, so the moment
 * EmailCriterion widens to `score: 0|1|2|3` the renderer reads them with no
 * change here. The proposal is already implemented on this side.
 */

import type { Criterion } from '../types.ts';
import type { DigestInput, EmailFind } from '../email/types.ts';
import type { Pick as SelectionPick, Selection } from './select.ts';
import { RUBRIC_VERSION } from './rubric.ts';

/** Nikhil's four criteria, in his own words where they fit a column heading. */
const LABELS: Record<Criterion, string> = {
  C1: 'What is advertised is true',
  C2: 'Solves a rare problem',
  C3: 'Usable by any person',
  C4: 'Agentic / MCP friendly',
};

const ORDER: readonly Criterion[] = ['C1', 'C2', 'C3', 'C4'];

/** Anything under this is not a positive finding. See the header. */
const SUPPORTED = 2;

function evidenceLine(criterion: Criterion, pick: SelectionPick): string {
  const rationale = pick.rationales[criterion];
  const score = pick.scores[criterion];
  if (!rationale) {
    // Should not happen -- selection requires all four -- but a missing
    // rationale must read as missing, never as a silent pass.
    return `No rationale was recorded for ${criterion} against this crawl generation.`;
  }
  return score === 1
    ? `NO EVIDENCE EITHER WAY -- this is not a failed check. ${rationale}`
    : rationale;
}

function toFind(pick: SelectionPick): EmailFind {
  return {
    name: pick.name,
    tagline: pick.why,
    url: pick.product_url,
    criteria: ORDER.map((criterion) => ({
      id: criterion,
      label: LABELS[criterion],
      verdict: pick.scores[criterion] >= SUPPORTED,
      evidence: evidenceLine(criterion, pick),
      // Extra fields, ignored by W6 today. The whole of the proposal.
      score: pick.scores[criterion],
      status: criterion === 'C1' ? pick.c1_status : undefined,
      rubric_version: RUBRIC_VERSION,
    })),
  };
}

/**
 * A day's selection as the send needs it.
 *
 * Returns null when nothing was selected. That is not a failure and it must
 * not become an empty digest: no file is written, W10's stage reports it, and
 * no email goes out. A day with nothing worth sending sends nothing.
 */
export function toDigestInput(selection: Selection): DigestInput | null {
  if (selection.picks.length === 0) return null;
  return { date: selection.date, finds: selection.picks.map(toFind) };
}
