/**
 * Proves the property the whole lane rests on: W4 does not fetch without an
 * ALLOW from the gate, and it never exceeds what bot.txt promises.
 *
 * These run against W1's REAL gate, not a stub. That is the point -- a stub
 * that always says yes tests the stub. The two refusals below (a loopback
 * address, and a domain on the manual denylist) are decided entirely offline
 * by rules P1 and P0, so the suite needs no network and touches nobody's site.
 */

import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { ACCEPTED_CONTENT_TYPES, R2_CAPS, REQUEST_HEADERS, USER_AGENT } from './config.ts';
import { gatedFetch, isNeverTouch, readCapped } from './gate.ts';
import { createRunState } from './gateAdapter.ts';

let server: Server;
let base: string;
/** Everything the local origin actually saw. If the gate says no, it stays empty. */
const requests: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>should never be reached</h1></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('nothing is fetched without an ALLOW', () => {
  it('sends zero bytes to a loopback address (P1)', async () => {
    const outcome = await gatedFetch(`${base}/`, createRunState());
    assert.ok(outcome.kind === 'refused');
    assert.equal(outcome.decision.allowed, false);
    assert.equal(outcome.decision.reason_code, 'url_out_of_scope');
    assert.equal(outcome.decision.precedence_rule, 'P1');
    // W4 itself sent nothing. The single request the origin saw is W1's own
    // robots.txt probe, which the gate makes BEFORE applying P1. Reported to
    // the coordinator as a bug: R2 §3.1 short-circuits on the first DENY and
    // P1 precedes P4, so a URL failing the private-address check should
    // produce no request at all -- as written, a candidate URL pointing at a
    // loopback or cloud-metadata address gets a real HTTP request out of the
    // pipeline before being denied. Tighten this to `[]` once W1 fixes it.
    assert.deepEqual(requests, ['/robots.txt'], 'W4 must add no request of its own to a DENY');
  });

  it('sends zero bytes to a domain on the manual denylist (P0)', async () => {
    const denylist = await readFile(new URL('../gate/denylist.txt', import.meta.url), 'utf8');
    const denied = denylist
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('#'));
    if (!denied) return; // An empty denylist is a legitimate state, not a failure.

    const outcome = await gatedFetch(`https://${denied}/`, createRunState());
    assert.ok(outcome.kind === 'refused');
    assert.equal(outcome.decision.reason_code, 'manual_denylist');
    assert.equal(outcome.decision.precedence_rule, 'P0');
    assert.equal(outcome.decision.expires_at, null, 'a human said no; only a human undoes it (R2 §7)');
  });

  it('never asks about a page R2 §5.4 says not to touch', () => {
    for (const path of ['/login', '/signup', '/register', '/checkout', '/account', '/wp-admin/x']) {
      assert.equal(isNeverTouch(`https://example.test${path}`), true, path);
    }
    assert.equal(isNeverTouch('https://example.test/pricing'), false);
  });
});

describe('the caps match what bot.txt publicly promises', () => {
  it('is the same User-Agent that the disclosure page publishes', async () => {
    const disclosure = await readFile(new URL('../../public/bot.txt', import.meta.url), 'utf8');
    assert.ok(
      disclosure.includes(USER_AGENT),
      `bot.txt does not contain ${USER_AGENT}. The UA in our requests and the UA on the page a site ` +
        `owner reads must be the same string, or the disclosure is false.`,
    );
    assert.ok(/at most 25 pages per site, at least 2 seconds apart/i.test(disclosure));
    assert.equal(R2_CAPS.maxPages, 25);
    assert.equal(R2_CAPS.minDelayMs, 2000);
  });

  it('sends no cookie and no authorization header, ever', () => {
    const names = Object.keys(REQUEST_HEADERS).map((name) => name.toLowerCase());
    assert.ok(!names.includes('cookie'), 'D3: Nikhil live Peerlist cookies are in this environment');
    assert.ok(!names.includes('authorization'));
    assert.equal(REQUEST_HEADERS['User-Agent'], USER_AGENT);
  });

  it('accepts only the content types R2 §5.3 lists', () => {
    assert.deepEqual([...ACCEPTED_CONTENT_TYPES], [
      'text/html',
      'application/xhtml+xml',
      'text/plain',
      'text/markdown',
      'application/json',
    ]);
  });
});

describe('response reading', () => {
  it('stops at the byte cap and says it truncated', async () => {
    const oversized = new Response('x'.repeat(R2_CAPS.maxResponseBytes + 1024));
    const { text, truncated } = await readCapped(oversized, R2_CAPS.maxResponseBytes);
    assert.equal(truncated, true);
    assert.equal(text.length, R2_CAPS.maxResponseBytes);
  });

  it('reads a short body whole and does not claim truncation', async () => {
    const { text, truncated } = await readCapped(new Response('hello'), R2_CAPS.maxResponseBytes);
    assert.equal(text, 'hello');
    assert.equal(truncated, false);
  });
});
