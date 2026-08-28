// Gate-internal types. These are candidates for finds/types.ts once W3 lands
// it -- propose additions through the coordinator rather than writing there
// directly (see finds-coord/DEPENDENCIES.md, FILE OWNERSHIP).

import type { SignalSource } from './config.ts';

export type RobotsDirective = 'allow' | 'disallow';

export interface RobotsRule {
  directive: RobotsDirective;
  /** Raw path pattern as written in robots.txt, e.g. "/search*". */
  pattern: string;
}

export interface RobotsGroup {
  /** Lower-cased user-agent product tokens this group applies to. */
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** True if the fetch that produced this succeeded (2xx). */
  fetched: boolean;
  /** HTTP status of the robots.txt fetch, or null if the request errored. */
  status: number | null;
}

export interface PathVerdict {
  path: string;
  allowed: boolean;
  reason: string;
  source: SignalSource;
  /** The specific rule/pattern that decided this, if any. */
  matchedRule?: string;
}

export interface SiteVerdict {
  origin: string;
  robotsTxtUrl: string;
  robotsTxtStatus: number | 'unreachable';
  crawlDelayMs: number;
  sitemaps: string[];
  checkedAt: string;
  userAgent: string;
}

export interface AuditRecord {
  url: string;
  verdict: PathVerdict;
  site: SiteVerdict;
}
