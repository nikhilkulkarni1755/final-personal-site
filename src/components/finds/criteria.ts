import type { Criterion, VerdictScore } from '../../../finds/types';

/** Display copy for the four fixed criteria. Types come from finds/types.ts (W3-owned); this file only owns the words shown on the page. */
export const CRITERION_ORDER: Criterion[] = ['C1', 'C2', 'C3', 'C4'];

export const CRITERION_LABELS: Record<Criterion, string> = {
  C1: 'Claim verified true',
  C2: 'Solves a rare problem',
  C3: 'Anyone can use it',
  C4: 'Agentic / MCP friendly',
};

/** Human reading of the 0-3 evidential-support scale (DEPENDENCIES.md, finds_verdicts). */
export const SCORE_LABELS: Record<VerdictScore, string> = {
  0: 'Evidence contradicts this',
  1: 'No evidence either way',
  2: 'Partially supported',
  3: 'Clearly supported',
};
