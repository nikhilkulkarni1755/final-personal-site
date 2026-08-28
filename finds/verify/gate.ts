/**
 * W4's side of the gate boundary.
 *
 * There is no `fetch()` in this file, and there must never be one again.
 *
 * D22 settled the shape after V2 measured what the previous one actually did:
 * W1's `checkPage` has to fetch the page itself to read X-Robots-Tag, meta
 * robots and tdm-reservation -- those signals exist only in the response -- and
 * W4 was then fetching the identical URL a second time for the body. On a
 * 40-link site that was 51 requests behind 25 evidence rows, in pairs ~2 ms
 * apart inside a 2 s sleep that only spaced the pairs. A site owner reading
 * their access log saw double the volume bot.txt promises, in exactly the burst
 * pattern the promise exists to deny.
 *
 * So the gate hands its response over and W4 uses it. One GET per URL, made by
 * the one module in the codebase that opens sockets -- which is also where
 * safeFetch.ts's guarantee lives that no request ever carries a Cookie or an
 * Authorization header. That matters concretely here: Nikhil's real Peerlist
 * session cookies exist in this environment (D3).
 *
 * The 2-second spacing and the 25-request cap moved into the gate with the
 * fetch, for the same reason: only the thing making the requests can count or
 * space them.
 */

import { NEVER_TOUCH_PATTERNS } from './config.ts';
import { decide, reportRefusal } from './gateAdapter.ts';
import type { RunState } from './gateAdapter.ts';
import type { FetchOutcome } from './types.ts';

/** R2 §3.6/§3.1 P3: statuses that deny the whole origin for the rest of the run. */
const ORIGIN_REFUSAL_STATUSES = new Set([401, 403, 429, 451]);

export interface GatedFetchOptions {
  candidateId?: string;
}

/** R2 §5.4. Checked before we ask the gate: no point spending a decision on it. */
export function isNeverTouch(url: string): boolean {
  const path = new URL(url).pathname;
  return NEVER_TOUCH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Ask the gate about `url` and return what it read, if it allowed it.
 *
 * Returns an evidence-bearing outcome in every case, including refusal, 404 and
 * a gate that could not read the body. It never throws for a normal HTTP
 * result: a 404 on /docs is a finding, not an error.
 */
export async function gatedFetch(url: string, runState: RunState, options: GatedFetchOptions = {}): Promise<FetchOutcome> {
  const decision = await decide(url, runState, options.candidateId);
  if (!decision.allowed) return { kind: 'refused', url, decision };

  const page = decision.page;
  if (!page) {
    // No second request to fall back on -- that fallback WAS the defect. A
    // gate that allows a URL without handing back what it read leaves W4 with
    // nothing to record, and D6 says that is reported, not worked around.
    return {
      kind: 'error',
      url,
      decision,
      error:
        `The gate allowed ${url} but returned no response body. W4 does not fetch it a second time: ` +
        `that doubled every request on the wire (D21/D22). This build of the gate is older than the ` +
        `handover contract.`,
      fetched_at: decision.decided_at,
      elapsed_ms: 0,
    };
  }

  // R2 §3.6: a page-level refusal denies the whole origin for the rest of this
  // run. The gate records it for the URL it happened on; propagating it to the
  // shared RunState is what stops the other 24 URLs being asked.
  if (ORIGIN_REFUSAL_STATUSES.has(page.http_status)) {
    reportRefusal(
      runState,
      decision.authority,
      page.http_status,
      `GET ${url} returned ${page.http_status}; the origin refused us, so the rest of this run stops here.`,
    );
  }

  return {
    kind: 'fetched',
    url,
    decision,
    final_url: page.final_url,
    http_status: page.http_status,
    content_type: page.content_type,
    body: page.body_read ? page.body : '',
    content_sha256: page.sha256 ?? '',
    truncated: page.truncated,
    fetched_at: page.fetched_at,
    elapsed_ms: page.elapsed_ms,
  };
}
