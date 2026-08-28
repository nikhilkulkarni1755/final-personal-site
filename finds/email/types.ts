// Narrow interface owned by W6, local to this lane on purpose.
//
// W3 (finds/types.ts) and W5 (finds/score/**) have not announced their
// selection/verdict shapes yet (see finds-coord/DEPENDENCIES.md, "SHAPES
// READY"). Per this lane's brief we do not block on them and do not invent
// their shapes as fact -- we declare the smallest shape the renderer needs,
// and swap it for the real import the moment DEPENDENCIES.md says it is
// ready. Nothing outside finds/email/** should import from here.

/** One of the four fixed selection criteria (see DECISIONS.md D7). */
export type CriterionId = 'C1' | 'C2' | 'C3' | 'C4';

/**
 * A single criterion verdict plus the evidence it was based on. Per D7 a
 * verdict is not a score -- it cites the actual evidence W4 collected (a
 * URL, a quote, a status code, a measured behaviour) so Nikhil can see why
 * the system decided what it decided and disagree with it.
 */
export interface EmailCriterion {
  id: CriterionId;
  /** Human label, e.g. "Solves a rare problem". */
  label: string;
  verdict: boolean;
  /** The evidence itself, already in prose. Never "feels agentic" -- a fact. */
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
