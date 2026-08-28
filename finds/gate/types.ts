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
  /** `restricts` names every field on this object the directive/signal
   * subtracted -- matches W3's GateUseRights (finds/types.ts) and R2 §6's
   * sample verdict object field-for-field. */
  reserved_by: Array<{ signal: UseSignal; directive: string; source_url: string; restricts: string[] }>;
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
  /** Null only when group_selection_basis is NOT_ATTEMPTED -- robots.txt was
   * never fetched because P0/P1/P2 denied the URL first (SSRF fix). */
  fetched_at: string | null;
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

/**
 * D21: the gate is the ONLY thing that opens a socket for a page's content
 * -- it already had to fetch the page once to read X-Robots-Tag/meta
 * robots/tdm-reservation (USE signals), and a second, uncoordinated fetch
 * by whoever consumes the verdict (W4) doubled every request, defeated the
 * page cap (it counts URLs, not requests), and produced exactly the burst
 * fingerprint bot.txt promises never to produce. `page` carries that one
 * fetch's result so nothing needs to fetch the URL again. Shaped to match
 * W4's own FetchOutcome (finds/verify/types.ts) so adopting it is a
 * near-drop-in swap, not a rewrite of their consumer.
 */
export type PageFetchOutcome =
  /** allowed=false, or allowed=true but the fetch never happened (denied
   * mid-flight by a page-level 401/403/429/451/challenge -- see gate.ts). */
  | { kind: 'not_fetched' }
  | {
      kind: 'fetched';
      /** After redirects. Differs from the verdict's `url` when the origin moved us. */
      final_url: string;
      http_status: number;
      content_type: string | null;
      /** Empty when the content type is not one R2 §5.3 accepts (images,
       * PDF, video, ...) -- the request still happened once, but the body
       * was never read, matching what a second fetch would have done anyway. */
      body: string;
      content_sha256: string;
      /** True when the R2 §5.3 2 MB per-response cap cut the body short. */
      truncated: boolean;
      fetched_at: string;
      elapsed_ms: number;
    }
  | { kind: 'error'; error: string; fetched_at: string; elapsed_ms: number };

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

/**
 * checkPage()'s actual return type. Deliberately NOT part of GateVerdict
 * itself -- `page` has no column in finds_crawl_verdicts (there is no page
 * body in that table, by design: it is a permission record, not a content
 * store), so folding it into the persisted shape would invite someone to
 * try to persist it there. `extends GateVerdict` means every existing
 * caller typed against `GateVerdict` keeps compiling unchanged; only a
 * caller that wants the page body needs to know this type exists.
 */
export interface GateVerdictWithPage extends GateVerdict {
  page: PageFetchOutcome;
}
