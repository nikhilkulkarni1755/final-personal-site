// URL scope checks -- rubric §3.1 rule P1 ("URL SANITY").
//
// Registrable-domain note: a correct implementation needs the Public Suffix
// List to handle multi-label TLDs (co.uk, com.au, ...). We do not vendor the
// PSL (it's a few hundred KB and changes over time) -- instead we ship a
// short hardcoded list of the multi-part suffixes most likely to appear
// among product-launch sites. This is a deliberate, logged simplification:
// an obscure ccTLD not on the list will be treated as a plain "label.tld"
// registrable domain, which can misjudge subdomain scope on that specific
// TLD. Flagged for R2/coordinator if it ever misfires in practice.
//
// DNS-rebinding note: the private/loopback/CGNAT check below resolves DNS
// once, at verdict time. It does not re-validate the IP the socket actually
// connects to, so a narrow rebinding window exists between this check and
// the real fetch. Logged as a known gap, not fixed here -- closing it fully
// needs control over the fetch's connect step (a custom dispatcher), which
// is a bigger change than this pass warrants.

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'ltd.uk', 'plc.uk',
  'co.jp', 'co.nz', 'co.za', 'co.in', 'co.kr', 'co.id',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.sg', 'com.tw', 'com.hk',
]);

export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join('.');
  return lastTwo;
}

export function isSameSite(hostnameA: string, hostnameB: string): boolean {
  return registrableDomain(hostnameA) === registrableDomain(hostnameB);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed -> fail closed
  const [a, b] = parts;
  if (a === 10) return true; // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 0) return true; // "this network"
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7)); // IPv4-mapped
  return false;
}

export interface UrlScopeResult {
  inScope: boolean;
  reason?: string;
}

/** §3.1 P1: scheme, private/loopback/link-local/CGNAT resolution, and the
 * candidate's own eTLD+1. */
export async function checkUrlScope(url: string, candidateOrigin: string): Promise<UrlScopeResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { inScope: false, reason: 'URL could not be parsed' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { inScope: false, reason: `scheme "${parsed.protocol}" is not http/https` };
  }

  const candidateHostname = new URL(candidateOrigin).hostname;
  if (!isSameSite(parsed.hostname, candidateHostname)) {
    return { inScope: false, reason: `${parsed.hostname} is not on the candidate's own eTLD+1 (${registrableDomain(candidateHostname)})` };
  }

  if (isIP(parsed.hostname)) {
    // A literal IP is never how a candidate is identified in this pipeline;
    // treat it the same as a resolved private address check.
    if (isIP(parsed.hostname) === 4 ? isPrivateIPv4(parsed.hostname) : isPrivateIPv6(parsed.hostname)) {
      return { inScope: false, reason: `${parsed.hostname} is a private/loopback/link-local/CGNAT address` };
    }
    return { inScope: true };
  }

  try {
    const { address, family } = await lookup(parsed.hostname);
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) {
      return { inScope: false, reason: `${parsed.hostname} resolves to a private/loopback/link-local/CGNAT address (${address})` };
    }
  } catch {
    return { inScope: false, reason: `DNS resolution failed for ${parsed.hostname}` };
  }

  return { inScope: true };
}
