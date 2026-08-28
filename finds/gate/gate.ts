// Orchestrator: the one entrypoint anything (lane W4 included) is allowed
// to fetch a page through. Ties config/robots/access/use/verdict/sitemap
// together but invents no policy itself -- every decision traces back to
// config.ts or to a signal one of the reader modules actually observed.

import { GATE_CONFIG } from './config.ts';
import { TtlCache } from './cache.ts';
import { fetchRobotsTxt, isBotChallenge, selectGroup } from './robots.ts';
import { safeFetch } from './safeFetch.ts';
import { extractApplicableDirectives, parseContentUsageHeader, parseTdmReservationHeader } from './headers.ts';
import { extractMetaRobotsDirectives, parseTdmReservationMeta } from './metaRobots.ts';
import { enumerateSitemaps } from './sitemap.ts';
import { createRunState, decideAccess, recordAuthorityDenial } from './access.ts';
import type { RunState } from './access.ts';
import { computeUseRights } from './use.ts';
import { expiresAt, ttlForReasonCode, ttlForRobotsOutcome } from './verdict.ts';
import { registrableDomain } from './scope.ts';
import type { CrawlBudget, EvidenceEntry, GateVerdict, RobotsOutcome, RobotsProvenance } from './types.ts';

const robotsCache = new TtlCache<RobotsOutcome>(GATE_CONFIG.ttl.allowMs);
const verdictCache = new TtlCache<GateVerdict>(GATE_CONFIG.ttl.allowMs);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRobotsOutcome(origin: string): Promise<RobotsOutcome> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  const outcome = await fetchRobotsTxt(origin);
  robotsCache.set(origin, outcome, ttlForRobotsOutcome(outcome));
  return outcome;
}

function pickAllowedResponseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of GATE_CONFIG.evidenceResponseHeaderAllowlist) {
    const v = res.headers.get(name);
    if (v !== null) out[name] = v;
  }
  return out;
}

function pageCapFor(delaySeconds: number): number {
  return Math.min(
    GATE_CONFIG.maxPagesAbsoluteCap,
    Math.max(GATE_CONFIG.maxPagesFloor, Math.floor(GATE_CONFIG.pageCapDelayBudgetSeconds / delaySeconds)),
  );
}

/** §5.3: delay = max(robots Crawl-delay, our own floor) when robots.txt
 * specifies one; otherwise our base delay. Page cap follows the same
 * delay via the formula in §5.3. */
function crawlBudgetFor(crawlDelaySeconds: number | null): CrawlBudget {
  const delaySeconds = crawlDelaySeconds !== null ? Math.max(crawlDelaySeconds, GATE_CONFIG.minCrawlDelaySeconds) : GATE_CONFIG.baseDelayMs / 1000;
  return {
    delay_ms: delaySeconds * 1000,
    delay_source: crawlDelaySeconds !== null ? 'CRAWL_DELAY' : 'DEFAULT',
    page_cap: pageCapFor(delaySeconds),
    depth_cap: GATE_CONFIG.maxCrawlDepth,
    wall_clock_ms: GATE_CONFIG.wallClockMsPerCandidate,
  };
}

interface PageFetch {
  status: number | null;
  challenge: boolean;
  headerDirectives: string[];
  metaDirectives: string[];
  tdmReservation: boolean;
  pageContentUsage: ReturnType<typeof parseContentUsageHeader>;
  evidence: EvidenceEntry;
}

/** One GET, shared across every USE signal that lives in a page's own
 * response (X-Robots-Tag, meta robots, tdm-reservation, Content-Usage). */
async function fetchPageForUseSignals(url: string): Promise<PageFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATE_CONFIG.totalTimeoutMs);
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const baseEvidence = {
    url,
    method: 'GET' as const,
    request_user_agent: GATE_CONFIG.userAgent,
    request_headers: { ...GATE_CONFIG.requestHeaders },
    fetched_at: fetchedAt,
  };
  try {
    const res = await safeFetch(url, { signal: controller.signal });
    const elapsedMs = Date.now() - startedAt;
    const contentType = res.headers.get('content-type');
    const rawXrt = res.headers.get('x-robots-tag');
    const headerDirectives = rawXrt ? extractApplicableDirectives(rawXrt, GATE_CONFIG.userAgentProductToken) : [];
    const tdmHeader = parseTdmReservationHeader(res.headers.get('tdm-reservation'));
    const pageContentUsage = parseContentUsageHeader(res.headers.get('content-usage'));

    let metaDirectives: string[] = [];
    let tdmMeta = false;
    if (contentType?.includes('html')) {
      const body = await res.text();
      metaDirectives = extractMetaRobotsDirectives(body, GATE_CONFIG.userAgentProductToken);
      tdmMeta = parseTdmReservationMeta(body);
    }

    return {
      status: res.status,
      challenge: isBotChallenge(res),
      headerDirectives,
      metaDirectives,
      tdmReservation: tdmHeader || tdmMeta,
      pageContentUsage,
      evidence: {
        ...baseEvidence,
        http_status: res.status,
        response_headers: pickAllowedResponseHeaders(res),
        content_length: res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null,
        sha256: null,
        body_excerpt: null,
        elapsed_ms: elapsedMs,
      },
    };
  } catch {
    return {
      status: null,
      challenge: false,
      headerDirectives: [],
      metaDirectives: [],
      tdmReservation: false,
      pageContentUsage: null,
      evidence: {
        ...baseEvidence,
        http_status: null,
        response_headers: {},
        content_length: null,
        sha256: null,
        body_excerpt: null,
        elapsed_ms: Date.now() - startedAt,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function robotsEvidenceEntry(origin: string, outcome: RobotsOutcome): EvidenceEntry {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  const base = {
    url: robotsUrl,
    method: 'GET' as const,
    request_user_agent: GATE_CONFIG.userAgent,
    request_headers: { ...GATE_CONFIG.requestHeaders },
    fetched_at: new Date().toISOString(),
  };
  if (outcome.kind === 'parsed') {
    return {
      ...base,
      http_status: outcome.status,
      response_headers: outcome.contentType ? { 'content-type': outcome.contentType } : {},
      content_length: outcome.byteLength,
      sha256: outcome.sha256,
      body_excerpt: outcome.bodyText,
      elapsed_ms: outcome.elapsedMs,
    };
  }
  return {
    ...base,
    http_status: outcome.status,
    response_headers: {},
    content_length: null,
    sha256: null,
    body_excerpt: null,
    elapsed_ms: 0,
  };
}

function robotsProvenance(origin: string, outcome: RobotsOutcome, decision: Awaited<ReturnType<typeof decideAccess>>): RobotsProvenance {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  if (outcome.kind === 'parsed') {
    const group = selectGroup(outcome.groups, GATE_CONFIG.userAgentProductToken).group;
    return {
      source_url: robotsUrl,
      final_url: outcome.finalUrl,
      redirect_hops: outcome.redirectHops,
      http_status: outcome.status,
      content_type: outcome.contentType,
      byte_length: outcome.byteLength,
      truncated: outcome.truncated,
      sha256: outcome.sha256,
      fetched_at: new Date().toISOString(),
      matched_group_token: decision.matchedGroupToken,
      group_selection_basis: decision.groupSelectionBasis,
      ai_tokens_disallowed: decision.aiTokensDisallowed,
      crawl_delay_seconds: decision.crawlDelaySeconds,
      sitemaps: outcome.sitemaps,
      content_signal: group?.contentSignal ?? null,
      content_usage: group?.contentUsage ?? null,
    };
  }
  return {
    source_url: robotsUrl,
    final_url: robotsUrl,
    redirect_hops: 0,
    http_status: outcome.status,
    content_type: null,
    byte_length: null,
    truncated: false,
    sha256: null,
    fetched_at: new Date().toISOString(),
    matched_group_token: null,
    group_selection_basis: outcome.kind === 'absent' ? 'NO_FILE' : 'NO_GROUP',
    ai_tokens_disallowed: [],
    crawl_delay_seconds: null,
    sitemaps: [],
    content_signal: null,
    content_usage: null,
  };
}

/** Provenance for a URL denied by P0/P1/P2, before robots.txt was ever
 * fetched. Distinguishing this from "fetched and found absent" is the whole
 * point of the SSRF fix: this record is proof no request left the process. */
function robotsProvenanceNotAttempted(origin: string): RobotsProvenance {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  return {
    source_url: robotsUrl,
    final_url: robotsUrl,
    redirect_hops: 0,
    http_status: null,
    content_type: null,
    byte_length: null,
    truncated: false,
    sha256: null,
    fetched_at: null, // never fetched -- see the doc comment on RobotsProvenance.fetched_at
    matched_group_token: null,
    group_selection_basis: 'NOT_ATTEMPTED',
    ai_tokens_disallowed: [],
    crawl_delay_seconds: null,
    sitemaps: [],
    content_signal: null,
    content_usage: null,
  };
}

/** Full permission + use-rights check for one URL. This is the only
 * function anything outside finds/gate/** should call to decide whether it
 * may fetch a page. `candidateId` is optional (null for standalone/CLI use)
 * -- W4 must supply it before persisting, since the DB column is NOT NULL.
 *
 * SECURITY: robots.txt is fetched lazily, inside access.ts's decideAccess,
 * only after P0 (denylist) and P1 (URL scope -- private/loopback/CGNAT
 * addresses) have both passed. A candidate URL is attacker-controlled input
 * (anyone can submit a launch pointing at 127.0.0.1 or a cloud metadata
 * address); fetching robots.txt before that check is answered would leak a
 * real request carrying our UA to a target the operator does not control.
 * Do not reintroduce an eager `getRobotsOutcome(authority)` call here. */
export async function checkPage(url: string, opts: { candidateId?: string | null; runState?: RunState } = {}): Promise<GateVerdict> {
  const cached = verdictCache.get(url);
  if (cached) return cached;

  const parsed = new URL(url);
  const authority = parsed.origin;
  const runState = opts.runState ?? createRunState();

  let robotsOutcome: RobotsOutcome | null = null;
  const decision = await decideAccess(
    url,
    authority,
    async () => {
      robotsOutcome = await getRobotsOutcome(authority);
      return robotsOutcome;
    },
    runState,
  );
  const decidedAt = new Date();

  const robots = robotsOutcome ? robotsProvenance(authority, robotsOutcome, decision) : robotsProvenanceNotAttempted(authority);
  const evidence: EvidenceEntry[] = robotsOutcome ? [robotsEvidenceEntry(authority, robotsOutcome)] : [];

  let useRights: GateVerdict['use_rights'] = null;
  let crawlBudget: CrawlBudget | null = null;

  if (decision.allowed) {
    crawlBudget = crawlBudgetFor(decision.crawlDelaySeconds);
    const pageFetch = await fetchPageForUseSignals(url);
    evidence.push(pageFetch.evidence);

    if (pageFetch.status !== null && [401, 403, 429, 451].includes(pageFetch.status)) {
      recordAuthorityDenial(runState, authority, {
        reasonCode: pageFetch.status === 429 ? 'origin_rate_limited' : 'origin_blocked_us',
        decidingSignal: pageFetch.status === 429 ? 'RATE_LIMIT' : 'HTTP_STATUS',
        detail: `a page on this authority returned ${pageFetch.status}`,
      });
      const verdict = finalize({
        url, authority, candidateId: opts.candidateId ?? null,
        allowed: false,
        reasonCode: pageFetch.status === 429 ? 'origin_rate_limited' : 'origin_blocked_us',
        reasonDetail: `page fetch returned ${pageFetch.status}`,
        decidingSignal: pageFetch.status === 429 ? 'RATE_LIMIT' : 'HTTP_STATUS',
        decidingRule: null, decidingGroup: null, precedenceRule: 'P3',
        useRights: null, crawlBudget: null, robots, evidence, decidedAt,
      });
      verdictCache.set(url, verdict, ttlForReasonCode(verdict.reason_code) ?? undefined);
      return verdict;
    }
    if (pageFetch.challenge) {
      recordAuthorityDenial(runState, authority, { reasonCode: 'bot_challenge', decidingSignal: 'BOT_CHALLENGE', detail: 'a page on this authority carried a bot-challenge header' });
      const verdict = finalize({
        url, authority, candidateId: opts.candidateId ?? null,
        allowed: false, reasonCode: 'bot_challenge', reasonDetail: 'page response carried a bot-challenge header', decidingSignal: 'BOT_CHALLENGE',
        decidingRule: null, decidingGroup: null, precedenceRule: 'P3',
        useRights: null, crawlBudget: null, robots, evidence, decidedAt,
      });
      verdictCache.set(url, verdict, ttlForReasonCode(verdict.reason_code) ?? undefined);
      return verdict;
    }

    useRights = computeUseRights({
      headerDirectives: pageFetch.headerDirectives,
      metaDirectives: pageFetch.metaDirectives,
      contentSignal: robots.content_signal,
      contentUsage: robots.content_usage ?? pageFetch.pageContentUsage ?? null,
      tdmReservation: pageFetch.tdmReservation,
      robotsSourceUrl: robots.source_url,
      pageUrl: url,
    });
  }

  const verdict = finalize({
    url, authority, candidateId: opts.candidateId ?? null,
    allowed: decision.allowed,
    reasonCode: decision.reasonCode,
    reasonDetail: decision.reasonDetail,
    decidingSignal: decision.decidingSignal,
    decidingRule: decision.decidingRule,
    decidingGroup: decision.decidingGroup,
    precedenceRule: decision.precedenceRule,
    useRights, crawlBudget, robots, evidence, decidedAt,
  });
  verdictCache.set(url, verdict, ttlForReasonCode(verdict.reason_code) ?? undefined);
  return verdict;
}

function finalize(args: {
  url: string; authority: string; candidateId: string | null;
  allowed: boolean; reasonCode: GateVerdict['reason_code']; reasonDetail: string;
  decidingSignal: GateVerdict['deciding_signal']; decidingRule: string | null; decidingGroup: string | null; precedenceRule: string;
  useRights: GateVerdict['use_rights']; crawlBudget: CrawlBudget | null; robots: RobotsProvenance; evidence: EvidenceEntry[]; decidedAt: Date;
}): GateVerdict {
  return {
    rubric_version: GATE_CONFIG.rubricVersion,
    gate_version: GATE_CONFIG.gateVersion,
    url: args.url,
    authority: args.authority,
    registrable_domain: registrableDomain(new URL(args.url).hostname),
    candidate_id: args.candidateId,
    allowed: args.allowed,
    reason_code: args.reasonCode,
    reason_detail: args.reasonDetail,
    deciding_signal: args.decidingSignal,
    deciding_rule: args.decidingRule,
    deciding_group: args.decidingGroup,
    precedence_rule: args.precedenceRule,
    use_rights: args.useRights,
    crawl_budget: args.crawlBudget,
    robots: args.robots,
    evidence: args.evidence,
    decided_at: args.decidedAt.toISOString(),
    expires_at: expiresAt(args.reasonCode, args.decidedAt),
  };
}

export interface SiteCheckResult {
  origin: string;
  allowed: GateVerdict[];
  disallowed: GateVerdict[];
  truncated: boolean;
}

/**
 * Enumerate a site's pages (from robots.txt Sitemap: directives, falling
 * back to the conventional /sitemap.xml) and check each against the gate,
 * up to the crawl budget's page cap, respecting its delay. All checks share
 * one RunState so P2/P3 (an authority denial found partway through) protect
 * every URL checked afterward.
 */
export async function checkSite(originUrl: string, opts: { candidateId?: string | null } = {}): Promise<SiteCheckResult> {
  const origin = new URL(originUrl).origin;
  const runState = createRunState();

  // No eager robots.txt fetch here (that was the same SSRF bug checkPage
  // had): let checkPage decide the homepage first, which only reaches
  // robots.txt itself after P0/P1/P2 pass.
  const homepage = await checkPage(origin + '/', { ...opts, runState });
  if (!homepage.allowed) {
    return { origin, allowed: [], disallowed: [homepage], truncated: false };
  }

  // Safe now: homepage.allowed can only be true if checkPage's P4-P7 logic
  // ran, which means the thunk fired and robotsCache is populated. The
  // getRobotsOutcome() fallback is defensive, not the expected path.
  const robotsOutcome = robotsCache.get(origin) ?? (await getRobotsOutcome(origin));
  const sitemaps = robotsOutcome.kind === 'parsed' && robotsOutcome.sitemaps.length > 0
    ? robotsOutcome.sitemaps
    : [new URL('/sitemap.xml', origin).toString()];
  const enumeration = await enumerateSitemaps(sitemaps, origin);

  const pageCap = homepage.crawl_budget?.page_cap ?? GATE_CONFIG.maxPagesFloor;
  const delayMs = homepage.crawl_budget?.delay_ms ?? GATE_CONFIG.baseDelayMs;
  const candidates = enumeration.pageUrls.filter((u) => u !== origin + '/').slice(0, pageCap - 1);
  const truncated = enumeration.truncated || candidates.length < enumeration.pageUrls.length - 1;

  const allowed: GateVerdict[] = [homepage];
  const disallowed: GateVerdict[] = [];

  for (let i = 0; i < candidates.length; i++) {
    await sleep(delayMs);
    const verdict = await checkPage(candidates[i], { ...opts, runState });
    (verdict.allowed ? allowed : disallowed).push(verdict);
  }

  return { origin, allowed, disallowed, truncated };
}
