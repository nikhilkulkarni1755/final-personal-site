/**
 * Local shape for a published find, until lane W3 ships `finds/types.ts`
 * (see ~/nsk1755/finds-coord/DEPENDENCIES.md, edge "W3 -> W7"). Delete this
 * file and import from there the moment W3 announces SHAPES READY.
 *
 * Mirrors the four fixed criteria from finds-coord/README.md's VERIFY step:
 * C1 the claim is true, C2 solves a rare problem, C3 anyone can use it,
 * C4 agentic/MCP friendly. Every field here is evidence text, not a score
 * (finds-coord/DECISIONS.md D7) -- a URL, a quote, a measured behaviour.
 */
export interface Find {
  id: string;
  name: string;
  /** The maker's own site -- this is the backlink. */
  url: string;
  tagline: string;
  /** Where it was discovered, e.g. "Peerlist", "Product Hunt", "Show HN". */
  source: string;
  /** ISO 8601 date this find was approved for publishing. */
  foundAt: string;
  evidence: {
    claimVerified: string;
    rareProblem: string;
    anyoneCanUse: string;
    agenticFriendly: string;
  };
}

export const CRITERIA = [
  { key: 'claimVerified', label: 'Claim verified true' },
  { key: 'rareProblem', label: 'Solves a rare problem' },
  { key: 'anyoneCanUse', label: 'Anyone can use it' },
  { key: 'agenticFriendly', label: 'Agentic / MCP friendly' },
] as const;
