/**
 * The only function in lane W4 that opens a socket.
 *
 * `gatedFetch` cannot be called without first obtaining a gate decision,
 * because it obtains one itself and returns `{ kind: 'refused' }` before any
 * network I/O when that decision is a DENY. There is deliberately no "just
 * check the homepage" escape hatch, no HEAD probe, and no unguarded fetch
 * helper anywhere else in finds/verify -- the whole pitch of this system is
 * that it is a well-behaved agent, and this file is where that is true or not.
 *
 * What this module does NOT do: decide. Every ALLOW/DENY comes from W1 via
 * gateAdapter. This module only carries out an already-granted permission,
 * inside R2 §5.3's caps.
 */

import { createHash } from 'node:crypto';
import { ACCEPTED_CONTENT_TYPES, NEVER_TOUCH_PATTERNS, R2_CAPS, REQUEST_HEADERS, USER_AGENT } from './config.ts';
import { decide, reportRefusal } from './gateAdapter.ts';
import type { RunState } from './gateAdapter.ts';
import type { FetchOutcome } from './types.ts';

/** R2 §5.3: strictly serial per authority. Two parallel requests is a load test. */
const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function respectDelay(authority: string, delayMs: number): Promise<void> {
  const previous = lastRequestAt.get(authority);
  if (previous !== undefined) {
    const waitMs = previous + delayMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  }
  lastRequestAt.set(authority, Date.now());
}

/**
 * R2 §2.3, asserted rather than assumed. Nikhil's live Peerlist session cookies
 * exist in this environment (DECISIONS D3); they must never reach a third-party
 * origin, and neither must any bearer token.
 */
function assertNoCredentials(headers: Record<string, string>): void {
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'cookie' || lower === 'authorization') {
      throw new Error(`W4 attempted to send a ${name} header. This is forbidden by R2 §2.3.`);
    }
  }
  if (headers['User-Agent'] !== USER_AGENT) {
    throw new Error('W4 attempted to send a User-Agent other than the one R2 §2.2 fixes. One identity, always.');
  }
}

function contentTypeAccepted(contentType: string | null): boolean {
  if (!contentType) return false;
  const essence = contentType.split(';')[0]!.trim().toLowerCase();
  return (ACCEPTED_CONTENT_TYPES as readonly string[]).includes(essence);
}

/** R2 §5.4. Checked before we ask the gate: no point spending a decision on it. */
export function isNeverTouch(url: string): boolean {
  const path = new URL(url).pathname;
  return NEVER_TOUCH_PATTERNS.some((pattern) => pattern.test(path));
}

/** Read at most `limit` bytes, then abort the stream. R2 §5.3. */
export async function readCapped(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limit) {
        chunks.push(value.subarray(0, value.byteLength - (total - limit)));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

export interface GatedFetchOptions {
  candidateId?: string;
}

/** R2 §3.6/§3.1 P3: statuses that deny the whole origin for the rest of the run. */
const ORIGIN_REFUSAL_STATUSES = new Set([401, 403, 429, 451]);

/**
 * Ask the gate about `url`, and fetch it only if the gate allowed it.
 *
 * Returns evidence-bearing outcomes in every case, including refusal, 404 and
 * transport failure. It never throws for a normal HTTP result: a 404 on /docs
 * is a finding, not an error (W3's migration says so explicitly).
 */
export async function gatedFetch(url: string, runState: RunState, options: GatedFetchOptions = {}): Promise<FetchOutcome> {
  // No injectable decision, deliberately: an options bag that accepts a
  // hand-made ALLOW is a way around the gate, and there must not be one.
  const decision = await decide(url, runState, options.candidateId);
  if (!decision.allowed) return { kind: 'refused', url, decision };

  const headers = { ...REQUEST_HEADERS };
  assertNoCredentials(headers);

  await respectDelay(decision.authority, decision.crawl_budget.delay_ms);

  const startedAt = Date.now();
  const fetched_at = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), R2_CAPS.totalTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    // R2 §3.6: a page-level refusal denies the whole origin for the rest of
    // this run. The gate cannot observe it -- W4 made the request -- so W4
    // hands it back, and every remaining URL on this authority is refused.
    if (ORIGIN_REFUSAL_STATUSES.has(response.status) || response.headers.get('cf-mitigated') === 'challenge') {
      reportRefusal(
        runState,
        decision.authority,
        response.status,
        `GET ${url} returned ${response.status}; the origin refused us, so the rest of this run stops here.`,
      );
    }
    const contentType = response.headers.get('content-type');
    // A body we are not allowed to read is still a status code worth recording.
    const readable = response.ok && contentTypeAccepted(contentType);
    const { text, truncated } = readable
      ? await readCapped(response, R2_CAPS.maxResponseBytes)
      : { text: '', truncated: false };
    if (!readable) await response.body?.cancel();
    return {
      kind: 'fetched',
      url,
      decision,
      final_url: response.url || url,
      http_status: response.status,
      content_type: contentType,
      body: text,
      content_sha256: createHash('sha256').update(text).digest('hex'),
      truncated,
      fetched_at,
      elapsed_ms: Date.now() - startedAt,
    };
  } catch (cause) {
    return {
      kind: 'error',
      url,
      decision,
      error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      fetched_at,
      elapsed_ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
