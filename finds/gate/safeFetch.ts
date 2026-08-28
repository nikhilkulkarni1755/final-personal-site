// Every network request the gate makes goes through here. Rubric §2.3 and
// §8.12: a hard assertion that no request ever carries Cookie or
// Authorization, and that the UA string is the one constant in §2.2 --
// fail loudly if either is violated. This matters concretely in this
// environment: Nikhil's real Peerlist session cookies exist here (DECISIONS
// D3), and a gate that ever let one leak to a third-party origin would be a
// real incident, not a bug report.
//
// This is the ONLY place `fetch()` should be called from finds/gate/**.

import { GATE_CONFIG } from './config.ts';

const FORBIDDEN_HEADER_NAMES = new Set(['cookie', 'authorization', 'proxy-authorization']);

function assertSafeHeaders(headers: RequestInit['headers']): void {
  if (!headers) return;
  const entries = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [name] of entries) {
    if (FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) {
      throw new Error(`safeFetch: refusing to send a "${name}" header -- the gate must never send credentials to a third-party origin`);
    }
  }
}

function assertConstantUserAgent(headers: RequestInit['headers']): void {
  const entries = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers ?? {});
  const ua = entries.find(([name]) => name.toLowerCase() === 'user-agent')?.[1];
  if (ua !== undefined && ua !== GATE_CONFIG.userAgent) {
    throw new Error(`safeFetch: refusing to send User-Agent "${ua}" -- the gate has exactly one identity (§2.2): "${GATE_CONFIG.userAgent}"`);
  }
}

/** GET/HEAD-only wrapper around fetch() enforcing §2.2/§2.3's hard rules. */
export function safeFetch(url: string, init: RequestInit & { method?: 'GET' | 'HEAD' } = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error(`safeFetch: refusing method "${method}" -- the gate only ever reads (§2.3, §5.3)`);
  }
  assertSafeHeaders(init.headers);
  assertConstantUserAgent(init.headers);

  return fetch(url, {
    ...init,
    method,
    headers: { 'User-Agent': GATE_CONFIG.userAgent, ...GATE_CONFIG.requestHeaders, ...init.headers },
  });
}
