/**
 * Shapes lane W4 (the verification crawler) speaks.
 *
 * Two of them are borrowed, not invented:
 *
 *  - `GateDecision` is the subset of R2's verdict object
 *    (research/R2-permission-rubric.md §6) that W4 actually consumes. W1 owns
 *    `finds/gate/**` and produces it; W4 only reads it. Fields W4 does not use
 *    (robots provenance, the gate's own fetch evidence) are deliberately absent
 *    -- they belong in `finds_crawl_verdicts`, which is W3's to write.
 *
 *  - `NewEvidence` mirrors W3's `finds_evidence` insert shape exactly
 *    (supabase/migrations/..._create_finds_evidence.sql). It is declared here
 *    only because that migration has not merged yet; when finds/types.ts gains
 *    the real one, DELETE this and import it. Same holding pattern W6 used for
 *    the digest shape.
 */

/* ========================================================================== */
/* the gate's answer -- R2 §6, the part W4 reads                               */
/* ========================================================================== */

/** R2 §6.1, the closed enum. Reproduced, never extended by W4. */
export type GateReasonCode =
  // ALLOW
  | 'robots_exact_group'
  | 'robots_allow'
  | 'robots_wildcard_allow'
  | 'robots_no_rules'
  | 'robots_absent'
  | 'robots_soft_404'
  | 'robots_redirect_loop'
  // DENY
  | 'manual_denylist'
  | 'url_out_of_scope'
  | 'robots_disallow'
  | 'robots_wildcard_disallow'
  | 'ai_block_inferred'
  | 'robots_forbidden'
  | 'robots_rate_limited'
  | 'robots_server_error'
  | 'robots_unreachable'
  | 'robots_bad_success'
  | 'origin_blocked_us'
  | 'origin_rate_limited'
  | 'bot_challenge'
  | 'unhandled_case';

/** R2 §6.2. USE-axis signals never appear here; they never decide access. */
export type GateDecidingSignal =
  | 'MANUAL_DENYLIST'
  | 'URL_POLICY'
  | 'ROBOTS_TXT'
  | 'AI_BLOCK_INFERENCE'
  | 'HTTP_STATUS'
  | 'BOT_CHALLENGE'
  | 'RATE_LIMIT'
  | 'CACHED_VERDICT'
  | 'UNHANDLED';

/** R2 §3.2. Computed per page; only `llm_ingest` gates W4's own work. */
export interface GateUseRights {
  llm_ingest: boolean;
  publish_excerpt: boolean;
  publish_link: boolean;
  follow_links: boolean;
  store_raw_body: boolean;
  /** Constant false. R2 §3.2: never true, not configurable. */
  train: false;
  max_snippet_chars: number | null;
}

/** R2 §5.3. W4 obeys these numbers; it does not choose them. */
export interface GateCrawlBudget {
  delay_ms: number;
  page_cap: number;
  depth_cap: number;
  wall_clock_ms: number;
}

export interface GateDecision {
  url: string;
  /** scheme://host[:port] -- R2 §1.2, the cache key. */
  authority: string;
  allowed: boolean;
  /**
   * Null when the gate did not supply one. W4 does NOT substitute a guess:
   * a fabricated reason code is a lie about why we crawled someone, which is
   * the exact question §6's verdict object exists to answer.
   */
  reason_code: GateReasonCode | null;
  /** Human-readable, from the gate verbatim. Never composed by W4. */
  reason_detail: string;
  deciding_signal: GateDecidingSignal | null;
  /**
   * Null when the gate did not compute the USE lattice. Null is NOT
   * "permissive" -- it is recorded as unknown and W5 decides what an unknown
   * costs. Only an explicit `false` makes W4 change its own behaviour.
   */
  use_rights: GateUseRights | null;
  crawl_budget: GateCrawlBudget;
  /** Which gate produced this, for the audit trail. */
  gate_version: string;
  decided_at: string;
}

/* ========================================================================== */
/* what one gated fetch produced                                               */
/* ========================================================================== */

/**
 * Every fetch W4 attempts ends in one of these, and every one of them is
 * recordable as evidence. There is no fourth outcome and no silent skip:
 * D6 means "we could not read it" is a finding, not an absence.
 */
export type FetchOutcome =
  /** The gate said no. Zero bytes left this process. */
  | { kind: 'refused'; url: string; decision: GateDecision }
  /** The gate said yes and the origin answered. Includes 404s and 500s. */
  | {
      kind: 'fetched';
      url: string;
      decision: GateDecision;
      /** After redirects. Differs from `url` when the origin moved us. */
      final_url: string;
      http_status: number;
      content_type: string | null;
      body: string;
      content_sha256: string;
      /** True when the §5.3 2 MB per-response cap cut the body short. */
      truncated: boolean;
      fetched_at: string;
      elapsed_ms: number;
    }
  /** The gate said yes and the transport failed. Also evidence. */
  | {
      kind: 'error';
      url: string;
      decision: GateDecision;
      error: string;
      fetched_at: string;
      elapsed_ms: number;
    };

/* ========================================================================== */
/* evidence -- mirrors W3's finds_evidence. DELETE when W3's types.ts lands.   */
/* ========================================================================== */

export type EvidencePageRole =
  | 'homepage'
  | 'pricing'
  | 'docs'
  | 'api'
  | 'mcp'
  | 'changelog'
  | 'about'
  | 'blog'
  | 'repo'
  | 'robots_txt'
  | 'llms_txt'
  | 'other';

/** What the page ASSERTS -- the left-hand side of the C1 diff. */
export interface EvidenceClaim {
  text: string;
  locator?: string;
}

/** Verbatim excerpt. Quoted, never paraphrased, so a score can be audited. */
export interface EvidenceQuote {
  text: string;
  locator?: string;
}

/** Measured behaviour rather than text. */
export interface EvidenceObservation {
  kind: string;
  detail?: string;
  value?: string | number | boolean | null;
}

export interface NewEvidence {
  candidate_id: string;
  /** One UUID per crawl pass, shared by every row that pass writes. */
  crawl_run_id: string;
  url: string;
  page_role: EvidencePageRole;
  http_status?: number | null;
  content_type?: string | null;
  content_sha256?: string | null;
  fetched_at?: string;
  claims?: EvidenceClaim[];
  quotes?: EvidenceQuote[];
  observations?: EvidenceObservation[];
}
