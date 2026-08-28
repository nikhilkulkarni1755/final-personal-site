/**
 * D21: the crawler must do what https://nikhilkulkarni1755.com/bot.txt says it
 * does. That page carries Nikhil's name and his email address, so a gap
 * between it and our behaviour is not a bug, it is a false statement to the
 * people whose sites we read.
 *
 * Everything here is offline. The route rule is a pure function, and the
 * hostile URLs are all denied by the gate at P1 before any socket opens.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { R2_CAPS } from './config.ts';
import { gatedFetch } from './gate.ts';
import { createRunState } from './gateAdapter.ts';
import { routeVerdict } from './render.ts';
import { normalise } from './scope.ts';

describe('C2 -- the browser cannot leave the origin the gate cleared', () => {
  const ALLOWED = 'https://example.test/app';
  const AUTHORITY = 'https://example.test';

  it('refuses the cloud-metadata address and every other host', () => {
    for (const hostile of [
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://127.0.0.1:8080/',
      'https://evil.test/exfil',
      'https://example.test.evil.test/',
      // A different port is a different authority (R2 §1.2).
      'https://example.test:8443/app',
    ]) {
      assert.equal(routeVerdict(hostile, 'xhr', ALLOWED, AUTHORITY), 'off-origin', hostile);
    }
  });

  it('refuses schemes that are not http(s)', () => {
    for (const scheme of ['data:text/html,<h1>x', 'blob:https://example.test/abc', 'file:///etc/passwd']) {
      assert.equal(routeVerdict(scheme, 'document', ALLOWED, AUTHORITY), 'off-origin', scheme);
    }
  });

  it('refuses a navigation to a same-origin page we hold no verdict for', () => {
    assert.equal(routeVerdict('https://example.test/other', 'document', ALLOWED, AUTHORITY), 'unverdicted-navigation');
    assert.equal(routeVerdict(ALLOWED, 'document', ALLOWED, AUTHORITY), 'allow');
  });

  it('refuses the content types R2 §5.3 never fetches, even same-origin', () => {
    for (const type of ['image', 'media', 'font', 'stylesheet']) {
      assert.equal(routeVerdict('https://example.test/a.png', type, ALLOWED, AUTHORITY), 'blocked-type');
    }
    assert.equal(routeVerdict('https://example.test/a.js', 'script', ALLOWED, AUTHORITY), 'allow');
  });
});

describe('C3 -- a hostile Sitemap: directive cannot steer the crawler', () => {
  const candidate = 'https://example.test/';

  it('is dropped before the gate ever sees it', () => {
    for (const hostile of [
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/admin',
      'https://evil.test/sitemap.xml',
      'file:///etc/passwd',
    ]) {
      assert.equal(normalise(hostile, candidate, candidate), null, hostile);
    }
  });

  it('still allows the site to declare its own sitemap', () => {
    assert.equal(
      normalise('https://example.test/sitemap-1.xml', candidate, candidate),
      'https://example.test/sitemap-1.xml',
    );
  });

  it('and the gate denies those targets anyway, with zero bytes sent', async () => {
    const runState = createRunState();
    const wire: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      wire.push(String(args[0]));
      return realFetch(...args);
    }) as typeof fetch;
    try {
      for (const hostile of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/admin']) {
        const outcome = await gatedFetch(hostile, runState);
        assert.ok(outcome.kind === 'refused', hostile);
        assert.equal(outcome.decision.precedence_rule, 'P1');
        assert.equal(outcome.decision.reason_code, 'url_out_of_scope');
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(wire, [], 'a denied URL must put nothing on the wire');
  });
});

describe('C1 -- W4 makes no request of its own', () => {
  it('has no fetch, no delay and no counter left in finds/verify (D22)', async () => {
    const source = await readFile(new URL('./gate.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bfetch\(/, 'the gate is the only thing that opens a socket');
    assert.doesNotMatch(code, /respectDelay|setTimeout\(resolve/, 'spacing belongs to the gate');
  });

  it('promises the same numbers the disclosure page publishes', async () => {
    const disclosure = await readFile(new URL('../../public/bot.txt', import.meta.url), 'utf8');
    assert.ok(/at most 25 pages per site, at least 2 seconds apart/i.test(disclosure));
    assert.equal(R2_CAPS.maxPages, 25);
    assert.equal(R2_CAPS.minDelayMs, 2000);
  });
});
