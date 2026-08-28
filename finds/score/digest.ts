/**
 * The handoff to the send: W5's selection, in the shape W6's `DigestInput`
 * declares, written to the file W10's daily runner passes to
 * `finds/email/send.ts`.
 *
 * NOTHING IS FLATTENED HERE ANY MORE. `EmailCriterion` used to type its verdict
 * as a BOOLEAN, which cannot tell "the evidence contradicts this" from "we
 * found no evidence either way" -- the two cases that matter most in a digest
 * whose whole pitch is that the checks are real. W6 has widened it to
 * `score: 0|1|2|3` plus C1's `status`, so the handoff now carries the
 * distinction the scorer computed rather than a mark plus an apology in the
 * prose. The "NO EVIDENCE EITHER WAY" prefix that used to lead a score-1
 * evidence line is gone with it: the rubric's own rationales already open with
 * the finding, and saying it twice would read as an excuse.
 *
 * The output is a `DigestSelection`, not a bare `DigestInput`: send.ts needs the
 * real `finds_candidates.id` beside each find to write finds_digest_items and
 * enforce "never send the same find twice". Same length, same order -- send.ts
 * refuses to guess if they disagree, which is the right posture and means this
 * side must never filter one list without the other.
 */

import type { Criterion } from '../types.ts';
import type { DigestSelection, EmailFind } from '../email/types.ts';
import type { Pick as SelectionPick, Selection } from './select.ts';

/** Nikhil's four criteria, in his own words where they fit a column heading. */
const LABELS: Record<Criterion, string> = {
  C1: 'What is advertised is true',
  C2: 'Solves a rare problem',
  C3: 'Usable by any person',
  C4: 'Agentic / MCP friendly',
};

const ORDER: readonly Criterion[] = ['C1', 'C2', 'C3', 'C4'];

function evidenceLine(criterion: Criterion, pick: SelectionPick): string {
  // Should not happen -- selection requires all four scored -- but a missing
  // rationale must read as missing, never as a silent pass.
  return (
    pick.rationales[criterion] ??
    `No rationale was recorded for ${criterion} against this crawl generation.`
  );
}

function toFind(pick: SelectionPick): EmailFind {
  return {
    name: pick.name,
    tagline: pick.why,
    url: pick.product_url,
    criteria: ORDER.map((criterion) => ({
      id: criterion,
      label: LABELS[criterion],
      score: pick.scores[criterion],
      // C1 only. Its three-way distinction is the one thing a score alone
      // cannot carry, and it is the reason this field exists on both sides.
      ...(criterion === 'C1' ? { status: pick.c1_status } : {}),
      evidence: evidenceLine(criterion, pick),
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
export function toDigestSelection(selection: Selection): DigestSelection | null {
  if (selection.picks.length === 0) return null;
  return {
    digest: { date: selection.date, finds: selection.picks.map(toFind) },
    // Built from the same array in the same pass, so the index alignment
    // send.ts checks cannot drift from one list being filtered alone.
    candidateIds: selection.picks.map((pick) => pick.candidate_id),
  };
}
