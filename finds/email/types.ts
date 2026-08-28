// Local to this lane, but no longer a stand-in: W3's finds_digests and W5's
// scoring/selection have both shipped (finds-coord/DEPENDENCIES.md "SHAPES
// READY"), and finds/score/digest.ts constructs exactly this shape as the
// handoff to send.ts. Nothing outside finds/email/** should import from here.

/** One of the four fixed selection criteria (see DECISIONS.md D7). */
export type CriterionId = 'C1' | 'C2' | 'C3' | 'C4';

/**
 * Evidential-support score, 0-3 -- the same scale as W3's VerdictScore
 * (finds/types.ts) and W5's CriterionScore (finds/score/types.ts):
 *   0 the evidence contradicts it | 1 no evidence either way
 *   2 partially supported         | 3 clearly supported by quoted/measured evidence
 * A find that scored 0 on any criterion is disqualified before it reaches
 * the digest (finds/score/select.ts), so 0 should not appear here in
 * practice -- it is still handled below rather than assumed away.
 */
export type EvidenceScore = 0 | 1 | 2 | 3;

/**
 * C1's own three-way distinction (finds/score/c1.ts, finds/score/types.ts).
 * Only C1 carries this: it is the one criterion whose verdict is a
 * claims-vs-evidence diff rather than a general support score, and
 * collapsing it to true/false is what this type used to do and no longer
 * does -- see the note on EmailCriterion below.
 *
 *   'corroborated'    a claim was checked against another page and holds
 *   'contradicted'    a claim is contradicted by evidence we hold
 *   'unsubstantiated' no corroborating evidence either way, and NOT a
 *                     failure -- a small honest project with thin docs is
 *                     not a liar, and rendering it as one would be the
 *                     single worst thing this digest could do.
 */
export type C1Status = 'corroborated' | 'contradicted' | 'unsubstantiated';

/**
 * A single criterion verdict plus the evidence it was based on. Per D7 a
 * verdict is not a score -- it cites the actual evidence W4 collected (a
 * URL, a quote, a status code, a measured behaviour) so Nikhil can see why
 * the system decided what it decided and disagree with it.
 *
 * This USED TO be a boolean `verdict`. It no longer is: a boolean cannot
 * represent "no evidence either way" without collapsing it into either a
 * pass or a fail, and collapsing it into a fail is close to accusing a real
 * company of lying on the strength of us not finding a page. `score` (and,
 * for C1, `status`) render the actual three-or-four-way distinction instead.
 */
export interface EmailCriterion {
  id: CriterionId;
  /** Human label, e.g. "Solves a rare problem". */
  label: string;
  score: EvidenceScore;
  /** Present for C1 only. */
  status?: C1Status;
  /** The evidence itself, already in prose. Never "feels agentic" -- a fact.
   * For criteria capped by the rubric rather than by the evidence (C2 tops
   * out at 2 under rubric 1.0: nothing on a product's own site can establish
   * that a problem is rare), the rationale says so -- render it in full, or
   * every product looks like it mysteriously tied on that criterion. */
  evidence: string;
}

/** One find as the digest needs to render it. */
export interface EmailFind {
  name: string;
  tagline: string;
  /** The maker's own site, not an aggregator listing. */
  url: string;
  /** Exactly four -- one per criterion, in C1..C4 order. */
  criteria: EmailCriterion[];
}

/** Everything the digest for one day needs. */
export interface DigestInput {
  /** ISO date (YYYY-MM-DD) the digest is for; drives the subject line. */
  date: string;
  finds: EmailFind[];
}

/**
 * What a real run hands to the CLIs: the render input, plus the real
 * `finds_candidates.id` for each entry in `digest.finds`, aligned by index.
 * dry-run.ts only reads `.digest` (candidate ids are irrelevant to a
 * render-only preview); send.ts needs both, because writing to
 * finds_digest_items and enforcing "never send the same find twice"
 * (finds_digests, migration 20260828210500) requires the real candidate id.
 */
export interface DigestSelection {
  digest: DigestInput;
  /** Same length and order as `digest.finds`. */
  candidateIds: string[];
}
