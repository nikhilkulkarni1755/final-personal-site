// Orchestrator: the one entrypoint anything (lane W4 included) is allowed
// to fetch a page through. Ties config/robots/access/use/verdict/sitemap
// together but invents no policy itself -- every decision traces back to
// config.ts or to a signal one of the reader modules actually observed.
//
// D21: this is also the ONLY place a page's content is fetched. checkPage
// used to fetch a URL once to read USE signals (X-Robots-Tag, meta robots,
// tdm-reservation) and discard the body, trusting the caller (W4) to fetch
// it again for verification. That second fetch was unpaced, uncounted
// against the page cap, and produced exactly the burst fingerprint
// https://nikhilkulkarni1755.com/bot.txt promises we never produce. Now
// checkPage returns the body it already fetched (GateVerdictWithPage), and
// request pacing lives here, keyed by RunState, so it holds regardless of
// who is calling -- this module, checkSite's own loop, or W4's crawler.
//
// V2-C3: a redirect changes the URL we actually fetch, and every guarantee
// above is evaluated against the URL we asked about. `redirect: 'manual'`
// plus a full per-hop P0/P1/P2/robots.txt decision (fetchWithGatedRedirects,
// below) closes that -- a redirect landing on a different, unchecked origin
// used to get exactly the request the P1 ordering fix exists to prevent.
//
// V2-C4: `candidateOrigin` used to always equal the URL's own origin (set
// by whichever caller invoked checkPage), which makes P1's same-site half
// a tautology -- it can never be false. checkPage now accepts a real
// `candidateOrigin` from the caller (checkSite passes the site being
// crawled; W4 should pass its own ProjectScope.authority, per D23), and
// falls back to the URL's own origin only when none is given -- the
// original, admittedly-tautological, but at least honest default for
// standalone use (CLI, tests) where there is no broader "project" to scope
// against.

import { createHash } from 'node:crypto';
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
import type { CrawlBudget, EvidenceEntry, GateVerdict, GateVerdictWithPage, PageFetchOutcome, RobotsOutcome, RobotsProvenance } from './types.ts';

const robotsCache = new TtlCache<RobotsOutcome>(GATE_CONFIG.ttl.allowMs);
const verdictCache = new TtlCache<GateVerdictWithPage>(GATE_CONFIG.ttl.allowMs);
/** Single-flight guard for robots.txt fetches -- see getRobotsOutcome. */
const robotsInFlight = new Map<string, Promise<RobotsOutcome>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * D21: the one place request pacing is enforced, for every request the
 * gate makes (robots.txt or a page's own content), keyed by authority and
 * shared across a whole crawl via RunState. Waits out whatever is left of
 * `delayMs` since this authority's last request, then records now as the
 * new last-request time -- so it holds even if two different URLs on one
 * authority are checked back to back by two different callers of checkPage
 * sharing the same RunState, or a redirect crosses into a second authority
 * mid-fetch (V2-C3).
 */
async function throttle(runState: RunState, authority: string, delayMs: number): Promise<void> {
  const last = runState.lastRequestAt.get(authority);
  if (last !== undefined) {
    const waitMs = last + delayMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  }
  runState.lastRequestAt.set(authority, Date.now());
}

/**
 * A production run measured this fetched twice for one authority, 1983ms
 * apart -- not a wrong cache key, a TOCTOU race: checkPage is called
 * concurrently (W4's crawler fires several URLs on one authority via
 * Promise.all), so two callers can both see a cache miss before either
 * finishes the fetch that would have populated it. Reproduced directly:
 * the pre-fix shape (check cache, await a slow fetch, then set cache)
 * issues N fetches for N concurrent callers of the same key every time;
 * confirmed with node:test-free inline script, 3 concurrent calls -> 3
 * fetches. Fixed with single-flight: the SECOND caller in past this
 * point awaits the SAME in-flight promise instead of starting its own
 * fetch, so the population of the cache (and the pacing/counting inside
 * fetchRobotsTxt's caller) happens exactly once per authority regardless
 * of how many callers arrive concurrently.
 */
async function getRobotsOutcome(origin: string, runState: RunState): Promise<RobotsOutcome> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const inFlight = robotsInFlight.get(origin);
  if (inFlight) return inFlight;

  const promise = (async () => {
    // First-ever request to a fresh authority: we don't know its Crawl-delay
    // yet (that's what this fetch determines), so pace against our own floor.
    await throttle(runState, origin, GATE_CONFIG.baseDelayMs);
    const outcome = await fetchRobotsTxt(origin);
    robotsCache.set(origin, outcome, ttlForRobotsOutcome(outcome));
    return outcome;
  })();
  robotsInFlight.set(origin, promise);
  try {
    return await promise;
  } finally {
    robotsInFlight.delete(origin);
  }
}

/** The known Crawl-delay for an authority whose robots.txt has already been
 * fetched, or null if unknown/absent/denied. */
function knownCrawlDelaySecondsFor(authority: string): number | null {
  const outcome = robotsCache.get(authority);
  if (!outcome || outcome.kind !== 'parsed') return null;
  const selection = selectGroup(outcome.groups, GATE_CONFIG.userAgentProductToken);
  return selection.group?.crawlDelaySeconds ?? null;
}

/** The real, now-known delay for an authority whose robots.txt has already
 * been fetched (it must have been, by the time a page fetch is reached --
 * decideAccess's P4-P7 require it). Falls back to our floor only for the
 * defensive case where it somehow has not. */
function knownDelayMsFor(authority: string): number {
  const crawlDelaySeconds = knownCrawlDelaySecondsFor(authority);
  return crawlDelaySeconds !== null ? Math.max(crawlDelaySeconds, GATE_CONFIG.minCrawlDelaySeconds) * 1000 : GATE_CONFIG.baseDelayMs;
}

function pickAllowedResponseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of GATE_CONFIG.evidenceResponseHeaderAllowlist) {
    const v = res.headers.get(name);
    if (v !== null) out[name] = v;
  }
  return out;
}

function contentTypeAccepted(contentType: string | null): boolean {
  if (!contentType) return false;
  const essence = contentType.split(';')[0]!.trim().toLowerCase();
  return (GATE_CONFIG.acceptedContentTypes as readonly string[]).includes(essence);
}

/** Read a response body up to maxBytes, streaming so a page never costs more
 * than the R2 §5.3 cap regardless of declared Content-Length. Mirrors W4's
 * own (now-obsolete) readCapped in finds/verify/gate.ts byte for byte. */
async function readTextCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf-8'), truncated };
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

/** Same budget, computed from whatever this authority's robots.txt is
 * already known to say -- used for a redirect hop, where we have no
 * `AccessDecision` object handy (see fetchWithGatedRedirects). */
function budgetForAuthority(authority: string): CrawlBudget {
  return crawlBudgetFor(knownCrawlDelaySecondsFor(authority));
}

/** D22, extended to redirect hops (V2-C3): the physical page-cap ceiling
 * for one authority. Refuses and returns false once `pageFetchCount`
 * reaches that authority's own `page_cap` -- never incremented on refusal,
 * so it holds no matter who calls it or how a redirect chain crosses
 * authorities within one run. */
function trySpendPageBudget(runState: RunState, authority: string): { ok: boolean; budget: CrawlBudget } {
  const budget = budgetForAuthority(authority);
  const spent = runState.pageFetchCount.get(authority) ?? 0;
  if (spent >= budget.page_cap) return { ok: false, budget };
  runState.pageFetchCount.set(authority, spent + 1);
  return { ok: true, budget };
}

function evidenceEntryFor(url: string, res: Response, fetchedAt: string, elapsedMs: number): EvidenceEntry {
  return {
    url,
    method: 'GET',
    request_user_agent: GATE_CONFIG.userAgent,
    request_headers: { ...GATE_CONFIG.requestHeaders },
    fetched_at: fetchedAt,
    http_status: res.status,
    response_headers: pickAllowedResponseHeaders(res),
    content_length: res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null,
    sha256: null,
    body_excerpt: null,
    elapsed_ms: elapsedMs,
  };
}

type HopOutcome =
  | { kind: 'settled'; res: Response; finalUrl: string; redirectHops: number; evidenceEntries: EvidenceEntry[] }
  | { kind: 'blocked'; redirectHops: number; evidenceEntries: EvidenceEntry[]; reason: string };

/**
 * V2-C3: fetches `startUrl` with `redirect: 'manual'` and, for every hop
 * beyond the first, runs the SAME P0/P1/P2/robots.txt decision
 * (decideAccess) and the SAME page-cap/pacing enforcement (D22) a
 * top-level URL gets -- reusing decideAccess rather than re-deriving a
 * parallel check, so a redirect target is judged by exactly the rules a
 * candidate URL is. A same-authority hop hits the cached robots.txt (no
 * extra request) but still gets its PATH re-matched, since a same-site
 * redirect can land on a path robots.txt disallows even when the origin
 * page was allowed. A cross-authority hop gets its own robots.txt fetch,
 * per R2 §3.6 ("separate authority -> its own robots.txt fetch and its
 * own verdict"). Hop 0 is the caller's own already-decided URL: no new
 * decideAccess/budget check for it, since checkPage already did both.
 * Capped at GATE_CONFIG.maxRedirects hops, matching robots.ts's own
 * fetchWithRedirects (which this mirrors) and R2 §5.3.
 */
async function fetchWithGatedRedirects(startUrl: string, candidateOrigin: string, runState: RunState): Promise<HopOutcome> {
  let currentUrl = startUrl;
  const evidenceEntries: EvidenceEntry[] = [];

  for (let hop = 0; hop <= GATE_CONFIG.maxRedirects; hop++) {
    if (hop > 0) {
      const authority = new URL(currentUrl).origin;
      const hopDecision = await decideAccess(currentUrl, candidateOrigin, () => getRobotsOutcome(authority, runState), runState);
      if (!hopDecision.allowed) {
        return {
          kind: 'blocked',
          redirectHops: hop,
          evidenceEntries,
          reason: `redirect to ${currentUrl} was denied: ${hopDecision.reasonCode} (${hopDecision.precedenceRule}) -- ${hopDecision.reasonDetail}`,
        };
      }
      const spend = trySpendPageBudget(runState, authority);
      if (!spend.ok) {
        return {
          kind: 'blocked',
          redirectHops: hop,
          evidenceEntries,
          reason: `redirect to ${currentUrl}: page cap (${spend.budget.page_cap}) for ${authority} already spent this run`,
        };
      }
      await throttle(runState, authority, knownDelayMsFor(authority));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GATE_CONFIG.totalTimeoutMs);
    const startedAt = Date.now();
    const fetchedAt = new Date().toISOString();
    let res: Response;
    try {
      res = await safeFetch(currentUrl, { redirect: 'manual', signal: controller.signal });
    } catch (err) {
      return {
        kind: 'blocked',
        redirectHops: hop,
        evidenceEntries,
        reason: `fetching ${currentUrl}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      };
    } finally {
      clearTimeout(timer);
    }
    const elapsedMs = Date.now() - startedAt;
    evidenceEntries.push(evidenceEntryFor(currentUrl, res, fetchedAt, elapsedMs));

    const isRedirect = res.status >= 300 && res.status < 400;
    if (!isRedirect) return { kind: 'settled', res, finalUrl: currentUrl, redirectHops: hop, evidenceEntries };

    await res.body?.cancel(); // a redirect's own body is never content we need
    const location = res.headers.get('location');
    if (!location) return { kind: 'settled', res, finalUrl: currentUrl, redirectHops: hop, evidenceEntries };
    if (hop === GATE_CONFIG.maxRedirects) {
      return { kind: 'blocked', redirectHops: hop, evidenceEntries, reason: `exceeded ${GATE_CONFIG.maxRedirects} redirects fetching ${startUrl}` };
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
  /* istanbul ignore next -- unreachable: the loop always returns by maxRedirects */
  return { kind: 'blocked', redirectHops: GATE_CONFIG.maxRedirects, evidenceEntries, reason: 'redirect loop' };
}

interface PageFetch {
  status: number | null;
  challenge: boolean;
  headerDirectives: string[];
  metaDirectives: string[];
  tdmReservation: boolean;
  pageContentUsage: ReturnType<typeof parseContentUsageHeader>;
  /** One entry per hop actually fetched (a redirect chain fetches more than one). */
  evidence: EvidenceEntry[];
  /** D21: the body this fetch already read, handed back so nothing needs
   * to fetch this URL a second time. */
  page: PageFetchOutcome;
}

/**
 * The GET(s) for a page: follows redirects itself (V2-C3, `redirect:
 * 'manual'` plus a per-hop gate decision -- see fetchWithGatedRedirects),
 * reads every USE signal that lives in the FINAL response (X-Robots-Tag,
 * meta robots, tdm-reservation, Content-Usage) AND the body itself (for
 * any R2 §5.3-accepted content type, capped at 2 MB), so this is also the
 * fetch W4 (or anything else) uses for verification. The first hop is
 * paced via `throttle()` against the starting authority before anything
 * is fetched; every later hop paces and cap-checks itself, per its own
 * authority, inside fetchWithGatedRedirects.
 */
async function fetchPageForUseSignals(url: string, candidateOrigin: string, runState: RunState): Promise<PageFetch> {
  const authority = new URL(url).origin;
  await throttle(runState, authority, knownDelayMsFor(authority));

  const hopResult = await fetchWithGatedRedirects(url, candidateOrigin, runState);

  if (hopResult.kind === 'blocked') {
    return {
      status: null,
      challenge: false,
      headerDirectives: [],
      metaDirectives: [],
      tdmReservation: false,
      pageContentUsage: null,
      evidence: hopResult.evidenceEntries,
      page: { kind: 'error', error: hopResult.reason, fetched_at: new Date().toISOString(), elapsed_ms: 0 },
    };
  }

  const { res, finalUrl } = hopResult;
  const fetchedAt = new Date().toISOString();
  const startedAt = Date.now();
  const contentType = res.headers.get('content-type');
  const rawXrt = res.headers.get('x-robots-tag');
  const headerDirectives = rawXrt ? extractApplicableDirectives(rawXrt, GATE_CONFIG.userAgentProductToken) : [];
  const tdmHeader = parseTdmReservationHeader(res.headers.get('tdm-reservation'));
  const pageContentUsage = parseContentUsageHeader(res.headers.get('content-usage'));

  const readable = contentTypeAccepted(contentType);
  let bodyText = '';
  let truncated = false;
  if (readable) {
    const capped = await readTextCapped(res, GATE_CONFIG.maxResponseBytes);
    bodyText = capped.text;
    truncated = capped.truncated;
  } else {
    await res.body?.cancel();
  }

  let metaDirectives: string[] = [];
  let tdmMeta = false;
  if (readable && contentType?.includes('html')) {
    metaDirectives = extractMetaRobotsDirectives(bodyText, GATE_CONFIG.userAgentProductToken);
    tdmMeta = parseTdmReservationMeta(bodyText);
  }

  const bodyReadElapsedMs = Date.now() - startedAt;
  const sha256 = readable ? createHash('sha256').update(bodyText).digest('hex') : null;

  return {
    status: res.status,
    challenge: isBotChallenge(res),
    headerDirectives,
    metaDirectives,
    tdmReservation: tdmHeader || tdmMeta,
    pageContentUsage,
    evidence: hopResult.evidenceEntries,
    page: {
      kind: 'fetched',
      final_url: finalUrl,
      http_status: res.status,
      content_type: contentType,
      body: bodyText,
      content_sha256: sha256 ?? '',
      truncated,
      fetched_at: fetchedAt,
      elapsed_ms: bodyReadElapsedMs,
    },
  };
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

const NOT_FETCHED: PageFetchOutcome = { kind: 'not_fetched' };

/** Full permission + use-rights check for one URL. This is the only
 * function anything outside finds/gate/** should call to decide whether it
 * may fetch a page -- AND the only function that fetches the page's own
 * content (D21). `candidateId` is optional (null for standalone/CLI use)
 * -- W4 must supply it before persisting, since the DB column is NOT NULL.
 * `runState` should be shared across every URL in one crawl: it is what
 * makes P2/P3 and D21's request pacing work across separate checkPage calls.
 *
 * `candidateOrigin` (V2-C4) is the site under evaluation for P1's same-site
 * check -- pass the real one (checkSite passes the site being crawled; W4
 * should pass its ProjectScope.authority, D23). Omitted, it falls back to
 * the URL's own origin, which makes that half of P1 trivially true; that is
 * the deliberate, honest default for standalone use (CLI, tests, a single
 * link with no broader project context), not a silent weakening.
 *
 * SECURITY: robots.txt is fetched lazily, inside access.ts's decideAccess,
 * only after P0 (denylist) and P1 (URL scope -- private/loopback/CGNAT
 * addresses) have both passed. A candidate URL is attacker-controlled input
 * (anyone can submit a launch pointing at 127.0.0.1 or a cloud metadata
 * address); fetching robots.txt before that check is answered would leak a
 * real request carrying our UA to a target the operator does not control.
 * Do not reintroduce an eager `getRobotsOutcome(authority)` call here.
 *
 * D21/V2-C3: `page` on the returned object IS the page's content, already
 * fetched through every redirect hop with its own P0/P1/robots decision --
 * callers must not fetch `url` (or wherever it redirects) again. A denied
 * verdict always carries `{kind: 'not_fetched'}`; never derive a body from
 * a verdict whose `allowed` is false. */
export async function checkPage(
  url: string,
  opts: { candidateId?: string | null; runState?: RunState; candidateOrigin?: string } = {},
): Promise<GateVerdictWithPage> {
  const cached = verdictCache.get(url);
  if (cached) return cached;

  const parsed = new URL(url);
  const authority = parsed.origin;
  const runState = opts.runState ?? createRunState();
  const candidateOrigin = opts.candidateOrigin ?? authority;

  let robotsOutcome: RobotsOutcome | null = null;
  const decision = await decideAccess(
    url,
    candidateOrigin,
    async () => {
      robotsOutcome = await getRobotsOutcome(authority, runState);
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

    // D22/D26: the physical page-cap ceiling -- both per-authority (this
    // specific subdomain's own Crawl-delay-derived cap) AND candidate-wide
    // (GATE_CONFIG.maxPagesAbsoluteCap total, across every authority this
    // RunState touches). Enforced here via the same trySpendPageBudget a
    // redirect hop uses, not by counting on the caller's side, so it holds
    // no matter how many times checkPage is called. ACCESS still says yes
    // (robots.txt permits it); we are simply choosing not to spend more of
    // the budget bot.txt promises a site owner. No request is made;
    // use_rights is null because it was never read, same as any other
    // not-evaluated page.
    const spentSoFar = runState.pageFetchCount.get(authority) ?? 0;
    if (spentSoFar >= crawlBudget.page_cap) {
      const verdict = finalize({
        url, authority, candidateId: opts.candidateId ?? null,
        allowed: true,
        reasonCode: decision.reasonCode,
        reasonDetail: `${decision.reasonDetail} (page cap of ${crawlBudget.page_cap} for this authority already spent this run; not fetched)`,
        decidingSignal: decision.decidingSignal,
        decidingRule: decision.decidingRule,
        decidingGroup: decision.decidingGroup,
        precedenceRule: decision.precedenceRule,
        useRights: null, crawlBudget, robots, evidence, decidedAt, page: NOT_FETCHED,
      });
      verdictCache.set(url, verdict, ttlForReasonCode(verdict.reason_code) ?? undefined);
      return verdict;
    }
    runState.pageFetchCount.set(authority, spentSoFar + 1);

    const pageFetch = await fetchPageForUseSignals(url, candidateOrigin, runState);
    evidence.push(...pageFetch.evidence);

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
        useRights: null, crawlBudget: null, robots, evidence, decidedAt, page: NOT_FETCHED,
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
        useRights: null, crawlBudget: null, robots, evidence, decidedAt, page: NOT_FETCHED,
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

    const verdict = finalize({
      url, authority, candidateId: opts.candidateId ?? null,
      allowed: true,
      reasonCode: decision.reasonCode,
      reasonDetail: decision.reasonDetail,
      decidingSignal: decision.decidingSignal,
      decidingRule: decision.decidingRule,
      decidingGroup: decision.decidingGroup,
      precedenceRule: decision.precedenceRule,
      useRights, crawlBudget, robots, evidence, decidedAt, page: pageFetch.page,
    });
    verdictCache.set(url, verdict, ttlForReasonCode(verdict.reason_code) ?? undefined);
    return verdict;
  }

  const verdict = finalize({
    url, authority, candidateId: opts.candidateId ?? null,
    allowed: false,
    reasonCode: decision.reasonCode,
    reasonDetail: decision.reasonDetail,
    decidingSignal: decision.decidingSignal,
    decidingRule: decision.decidingRule,
    decidingGroup: decision.decidingGroup,
    precedenceRule: decision.precedenceRule,
    useRights: null, crawlBudget: null, robots, evidence, decidedAt, page: NOT_FETCHED,
  });
  verdictCache.set(url, verdict, ttlForReasonCode(verdict.reason_code) ?? undefined);
  return verdict;
}

function finalize(args: {
  url: string; authority: string; candidateId: string | null;
  allowed: boolean; reasonCode: GateVerdict['reason_code']; reasonDetail: string;
  decidingSignal: GateVerdict['deciding_signal']; decidingRule: string | null; decidingGroup: string | null; precedenceRule: string;
  useRights: GateVerdict['use_rights']; crawlBudget: CrawlBudget | null; robots: RobotsProvenance; evidence: EvidenceEntry[]; decidedAt: Date;
  page: PageFetchOutcome;
}): GateVerdictWithPage {
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
    page: args.page,
  };
}

export interface SiteCheckResult {
  origin: string;
  allowed: GateVerdictWithPage[];
  disallowed: GateVerdictWithPage[];
  truncated: boolean;
}

/**
 * Enumerate a site's pages (from robots.txt Sitemap: directives, falling
 * back to the conventional /sitemap.xml) and check each against the gate,
 * up to the crawl budget's page cap. All checks share one RunState so
 * P2/P3 (an authority denial found partway through) AND D21's request
 * pacing (enforced inside checkPage/fetchPageForUseSignals, not here)
 * protect and space every URL checked afterward -- this loop does not
 * sleep itself; doing so as well would double the delay. Every checkPage
 * call is given `candidateOrigin: origin` explicitly (V2-C4) -- the site
 * being crawled, not each candidate URL's own origin -- so P1's same-site
 * check is doing real work here (a sitemap entry on a different registrable
 * domain is correctly out of scope; one on a same-domain subdomain is not).
 */
export async function checkSite(originUrl: string, opts: { candidateId?: string | null } = {}): Promise<SiteCheckResult> {
  const origin = new URL(originUrl).origin;
  const runState = createRunState();

  // No eager robots.txt fetch here (that was the same SSRF bug checkPage
  // had): let checkPage decide the homepage first, which only reaches
  // robots.txt itself after P0/P1/P2 pass.
  const homepage = await checkPage(origin + '/', { ...opts, runState, candidateOrigin: origin });
  if (!homepage.allowed) {
    return { origin, allowed: [], disallowed: [homepage], truncated: false };
  }

  // Safe now: homepage.allowed can only be true if checkPage's P4-P7 logic
  // ran, which means the thunk fired and robotsCache is populated. The
  // getRobotsOutcome() fallback is defensive, not the expected path.
  const robotsOutcome = robotsCache.get(origin) ?? (await getRobotsOutcome(origin, runState));
  const sitemaps = robotsOutcome.kind === 'parsed' && robotsOutcome.sitemaps.length > 0
    ? robotsOutcome.sitemaps
    : [new URL('/sitemap.xml', origin).toString()];
  const enumeration = await enumerateSitemaps(sitemaps, origin);

  const pageCap = homepage.crawl_budget?.page_cap ?? GATE_CONFIG.maxPagesFloor;
  const candidates = enumeration.pageUrls.filter((u) => u !== origin + '/').slice(0, pageCap - 1);
  const truncated = enumeration.truncated || candidates.length < enumeration.pageUrls.length - 1;

  const allowed: GateVerdictWithPage[] = [homepage];
  const disallowed: GateVerdictWithPage[] = [];

  for (const candidate of candidates) {
    const verdict = await checkPage(candidate, { ...opts, runState, candidateOrigin: origin });
    (verdict.allowed ? allowed : disallowed).push(verdict);
  }

  return { origin, allowed, disallowed, truncated };
}
