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
import { readFile as readSource } from 'node:fs/promises';
import { R2_CAPS, USER_AGENT } from './config.ts';
import { gatedFetch, isNeverTouch } from './gate.ts';
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
    // FIXED (was the SSRF bug: W1's gate fetched /robots.txt BEFORE applying
    // P1). access.ts now takes robots.txt as a thunk that P0/P1/P2 must all
    // pass before it is ever invoked, so a P1 denial leaves zero bytes.
    assert.deepEqual(requests, [], 'zero bytes may leave the process for a URL P1 denies');
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

  it('leaves the no-credentials guarantee to safeFetch, which owns the socket', async () => {
    const safeFetch = await readSource(new URL('../gate/safeFetch.ts', import.meta.url), 'utf8');
    assert.match(safeFetch, /cookie/i, 'D3: Nikhil real Peerlist cookies are in this environment');
    assert.match(safeFetch, /authorization/i);
  });

});

describe('W4 opens no sockets of its own (D22)', () => {
  it('has no fetch, no delay and no byte cap left in this lane', async () => {
    const source = await readSource(new URL('./gate.ts', import.meta.url), 'utf8');
    // Comments stripped: the file's own doc block explains why there is no
    // fetch here, and that sentence is not a fetch.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bfetch\(/, 'the gate is the only module that opens a socket');
    assert.doesNotMatch(code, /respectDelay|readCapped/, 'spacing and byte caps moved to the gate with the fetch');
  });

  it('reports a gate that hands back no body instead of fetching it itself', async () => {
    const source = await readSource(new URL('./gate.ts', import.meta.url), 'utf8');
    assert.match(source, /allowed \${url} but did not fetch it/);
  });
});
