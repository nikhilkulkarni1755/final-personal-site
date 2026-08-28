// Gate-internal types. Two casing conventions, deliberately:
//
//   - Parsing/decision-internal types (RobotsRule, RobotsGroup,
//     RobotsOutcome) are camelCase, ordinary TypeScript style. Nothing
//     outside finds/gate/** touches them.
//   - Wire-format types (ContentSignal, ContentUsage, UseRights,
//     CrawlBudget, RobotsProvenance, EvidenceEntry, GateVerdict) are
//     snake_case, matching R2-permission-rubric.md §6's verdict object and
//     W3's finds_crawl_verdicts/finds_crawl_evidence columns field-for-field
//     (supabase/migrations/20260828210600_create_finds_crawl_verdicts.sql
//     on main). GateVerdict IS what gets persisted (as JSONB for
//     use_rights/crawl_budget/robots); matching casing exactly means W4
//     inserts it with no remapping step to get subtly wrong.
//
// Candidates for finds/types.ts once W3's TS types land there -- propose
// through the coordinator rather than writing there directly
// (DEPENDENCIES.md, FILE OWNERSHIP). Known simplifications vs. the full §6
// shape are called out inline; each is a deliberate, logged deviation.

import type { DecidingSignal, GroupSelectionBasis, ReasonCode, UseSignal } from './config.ts';

export type RobotsDirective = 'allow' | 'disallow';

export interface RobotsRule {
  directive: RobotsDirective;
  /** Raw path pattern as written in robots.txt, e.g. "/search*". */
  pattern: string;
}

/** §1.5 S8 -- Cloudflare Content Signals, a directive inside a robots.txt group. */
export interface ContentSignal {
  search?: 'yes' | 'no';
  ai_input?: 'yes' | 'no';
  ai_train?: 'yes' | 'no';
  /** `use=immediate|reference|full` -- recorded, no defined mapping (§1.5). */
  use?: string;
}

/** §1.5 S9 -- IETF aipref. Origin-scoped (from robots.txt) or page-scoped
 * (from a response header) -- see headers.ts's parseContentUsageHeader.
 * Path-scoped robots.txt forms ("Content-Usage: /ai-ok/ train-ai=y") are not
 * parsed by this v1 -- flagged as a known gap in robots.ts. */
export interface ContentUsage {
  train_ai?: 'y' | 'n';
  search?: 'y' | 'n';
}

export interface RobotsGroup {
  /** Lower-cased user-agent product tokens this group applies to. */
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
  contentSignal?: ContentSignal;
  contentUsage?: ContentUsage;
}

/** The three-way outcome of fetching robots.txt, per rubric §1.3. */
export type RobotsOutcome =
  | {
      kind: 'parsed';
      groups: RobotsGroup[];
      sitemaps: string[];
      truncated: boolean;
      byteLength: number;
      finalUrl: string;
      redirectHops: number;
      status: number;
      contentType: string | null;
      sha256: string;
      elapsedMs: number;
      /** Verbatim, up to config.robotsTxtMaxBytes -- the primary exhibit (§6). */
      bodyText: string;
    }
  | {
      kind: 'absent'; // treated as full access, no rules to apply
      reasonCode: 'robots_absent' | 'robots_soft_404' | 'robots_redirect_loop';
      status: number | null;
    }
  | {
      kind: 'denied'; // the whole origin is denied -- deliberate deviations from RFC 9309 §2.3.1.3, see §1.3
      reasonCode: 'robots_forbidden' | 'robots_rate_limited' | 'robots_server_error' | 'robots_unreachable' | 'robots_bad_success' | 'bot_challenge';
      status: number | null;
    };

export interface UseRights {
  llm_ingest: boolean;
  publish_excerpt: boolean;
  publish_link: boolean;
  follow_links: boolean;
  store_raw_body: boolean;
  /** Constant false, always -- never configurable (§3.2). */
  train: false;
  max_snippet_chars: number | null;
  reserved_by: Array<{ signal: UseSignal; directive: string; source_url: string }>;
}

export interface CrawlBudget {
  delay_ms: number;
  delay_source: 'CRAWL_DELAY' | 'DEFAULT';
  page_cap: number;
  depth_cap: number;
  wall_clock_ms: number;
}

export interface RobotsProvenance {
  source_url: string;
  final_url: string;
  redirect_hops: number;
  http_status: number | null;
  content_type: string | null;
  byte_length: number | null;
  truncated: boolean;
  sha256: string | null;
  fetched_at: string;
  matched_group_token: string | null;
  group_selection_basis: GroupSelectionBasis;
  ai_tokens_disallowed: string[];
  crawl_delay_seconds: number | null;
  sitemaps: string[];
  content_signal: ContentSignal | null;
  content_usage: ContentUsage | null;
}

/** One fetch made in service of a verdict -> one finds_crawl_evidence row.
 * Simplified vs. the DB column set: no remote_ip (not exposed by fetch()). */
export interface EvidenceEntry {
  url: string;
  method: 'GET' | 'HEAD';
  request_user_agent: string;
  /** Never contains Cookie/Authorization -- safeFetch.ts refuses to send them. */
  request_headers: Record<string, string>;
  http_status: number | null;
  /** Allowlisted subset only (config.evidenceResponseHeaderAllowlist). */
  response_headers: Record<string, string>;
  content_length: number | null;
  sha256: string | null;
  /** robots.txt only: verbatim, up to config.robotsTxtMaxBytes. */
  body_excerpt: string | null;
  fetched_at: string;
  elapsed_ms: number;
}

/** The gate's return value for one URL -- matches R2-permission-rubric.md §6
 * and finds_crawl_verdicts. `candidate_id` is null when the gate is used
 * standalone (e.g. the CLI); W4 must set it before persisting, since the
 * column is NOT NULL. */
export interface GateVerdict {
  rubric_version: string;
  gate_version: string;

  url: string;
  authority: string;
  registrable_domain: string;
  candidate_id: string | null;

  // ---- ACCESS ----
  allowed: boolean;
  reason_code: ReasonCode;
  reason_detail: string;
  deciding_signal: DecidingSignal;
  deciding_rule: string | null;
  deciding_group: string | null;
  precedence_rule: string; // "P0".."P8"

  // ---- USE (only meaningful when allowed) ----
  use_rights: UseRights | null;

  // ---- what we will do if allowed ----
  crawl_budget: CrawlBudget | null;

  // ---- robots.txt provenance ----
  robots: RobotsProvenance;

  // ---- everything fetched to reach this decision ----
  evidence: EvidenceEntry[];

  decided_at: string;
  expires_at: string | null; // null only for manual_denylist (§7)
}
