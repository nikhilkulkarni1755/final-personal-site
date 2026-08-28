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
import { decide } from './gateAdapter.ts';
import type { FetchOutcome, GateDecision } from './types.ts';

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
async function readCapped(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
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
  /**
   * Reuse an already-obtained decision for this exact URL. The gate is still
   * the authority -- this only avoids asking it twice in one pass.
   */
  decision?: GateDecision;
}

/**
 * Ask the gate about `url`, and fetch it only if the gate allowed it.
 *
 * Returns evidence-bearing outcomes in every case, including refusal, 404 and
 * transport failure. It never throws for a normal HTTP result: a 404 on /docs
 * is a finding, not an error (W3's migration says so explicitly).
 */
export async function gatedFetch(url: string, options: GatedFetchOptions = {}): Promise<FetchOutcome> {
  const decision = options.decision ?? (await decide(url));
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
