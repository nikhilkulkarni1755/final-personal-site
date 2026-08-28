/**
 * Proves the property the whole lane rests on: W4 does not fetch without an
 * ALLOW from the gate.
 *
 * The stub gates below are written to a temp dir and deleted, per D6 -- a
 * committed fixture that says "allowed: true" is exactly the thing that must
 * never be able to leak into a run.
 */

import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { R2_CAPS, USER_AGENT } from './config.ts';
import { decide } from './gateAdapter.ts';
import { gatedFetch } from './gate.ts';

let workDir: string;
let server: Server;
let base: string;
/** Everything the origin actually saw. If the gate said no, this stays empty. */
const requests: { url: string; headers: Record<string, string | string[] | undefined> }[] = [];

async function writeStubGate(name: string, body: string): Promise<string> {
  const path = join(workDir, `${name}.ts`);
  await writeFile(path, body, 'utf8');
  return path;
}

function useGate(gatePath: string): void {
  process.env.FINDS_GATE_MODULE = gatePath;
}

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'w4-gate-'));
  server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', headers: req.headers });
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(R2_CAPS.maxResponseBytes + 1024));
      return;
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><body>not found</body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>hello</h1></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workDir, { recursive: true, force: true });
});

describe('the gate is the only way through', () => {
  it('refuses to fetch when no gate module exists, rather than falling back', async () => {
    useGate(join(workDir, 'does-not-exist.ts'));
    await assert.rejects(() => gatedFetch(`${base}/`), /cannot reach the permission gate/);
    assert.equal(requests.length, 0, 'a missing gate must not produce a request');
  });

  it('sends zero bytes when the gate denies', async () => {
    const gate = await writeStubGate(
      'deny',
      `export async function checkPage(url) {
         return { verdict: { allowed: false, reason: 'stub deny', source: 'robots-txt' } };
       }`,
    );
    useGate(gate);
    const outcome = await gatedFetch(`${base}/`);
    assert.ok(outcome.kind === 'refused');
    assert.equal(outcome.decision.allowed, false);
    assert.equal(outcome.decision.reason_detail, 'stub deny');
    assert.equal(requests.length, 0, 'a DENY must not produce a request');
  });

  it('refuses a gate answer it does not understand instead of guessing yes', async () => {
    const gate = await writeStubGate('weird', `export async function checkPage() { return { ok: 'sure' }; }`);
    useGate(gate);
    await assert.rejects(() => gatedFetch(`${base}/`), /shape W4 does not recognise/);
    assert.equal(requests.length, 0);
  });

  it('fetches under the honest UA once the gate allows, and records a 404 as evidence', async () => {
    const gate = await writeStubGate(
      'allow',
      `export async function checkPage(url) {
         return { verdict: { allowed: true, reason: 'stub allow', source: 'robots-txt' },
                  site: { crawlDelayMs: 0 } };
       }`,
    );
    useGate(gate);

    const ok = await gatedFetch(`${base}/`);
    assert.ok(ok.kind === 'fetched');
    assert.equal(ok.http_status, 200);
    assert.match(ok.body, /hello/);
    assert.equal(ok.content_sha256.length, 64);
    assert.equal(requests.at(-1)?.headers['user-agent'], USER_AGENT);
    assert.equal(requests.at(-1)?.headers.cookie, undefined);
    assert.equal(requests.at(-1)?.headers.authorization, undefined);

    const missing = await gatedFetch(`${base}/missing`);
    assert.ok(missing.kind === 'fetched');
    assert.equal(missing.http_status, 404, 'a 404 is a recorded outcome, not a skip');

    const big = await gatedFetch(`${base}/big`);
    assert.ok(big.kind === 'fetched');
    assert.equal(big.truncated, true);
    assert.equal(big.body.length, R2_CAPS.maxResponseBytes);
  });

  it('holds the R2 §5.3 floor even when the gate offers a faster budget', async () => {
    const gate = await writeStubGate(
      'fast',
      `export async function checkPage() {
         return { allowed: true, reason_code: 'robots_allow',
                  crawl_budget: { delay_ms: 1, page_cap: 9999, depth_cap: 9, wall_clock_ms: 9e9 } };
       }`,
    );
    useGate(gate);
    const decision = await decide(`${base}/`);
    assert.equal(decision.crawl_budget.delay_ms, R2_CAPS.minDelayMs);
    assert.equal(decision.crawl_budget.page_cap, R2_CAPS.maxPages);
    assert.equal(decision.crawl_budget.depth_cap, R2_CAPS.maxDepth);
    assert.equal(decision.crawl_budget.wall_clock_ms, R2_CAPS.wallClockMs);
  });
});
