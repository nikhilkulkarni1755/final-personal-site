/**
 * D23: we crawled the wrong website for roughly 45% of candidates.
 *
 * A GitHub repo with no declared homepage becomes product_url
 * `https://github.com/owner/repo`. Scoping the crawl to the AUTHORITY walked
 * GitHub Inc.'s own site and attributed it to the maker. On
 * github.com/affirmitv/ghosthands that was 24 pages crawled with ONE of them
 * the repo; a C4 of 3 for "an MCP endpoint linked from the site's own pages"
 * was GitHub's endpoint; and the only C1 contradiction the system produced all
 * day was a real project's README claim about a free offline tier "refuted" by
 * "Start a free 30 day trial today" off github.com/pricing.
 *
 * Every quote was real. All of them were misattributed, which tells the same
 * lie as inventing one -- and a contradiction is disqualifying under D7, so it
 * killed a real person's project on a sentence written by GitHub Inc.
 *
 * The rule under test is generic. github.com appears here as the case that was
 * caught, not as a special case in the code: gitlab.com, huggingface.co,
 * itch.io, notion.site and the next shared host all take the same path.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalise, projectScope, withinScope } from './scope.ts';

describe('a project that owns its domain', () => {
  const scope = projectScope('https://usesesame.app/');

  it('owns the whole authority, subdomains included', () => {
    assert.equal(scope.ownsAuthority, true);
    assert.equal(scope.prefix, '/');
    assert.ok(withinScope('https://usesesame.app/pricing', scope));
    assert.ok(withinScope('https://status.usesesame.app/', scope), 'a status subdomain is still theirs');
  });

  it('still stops at somebody else entirely', () => {
    assert.equal(withinScope('https://github.com/pricing', scope), false);
    assert.equal(withinScope('http://169.254.169.254/', scope), false);
  });

  it('treats a bare index path as the root, not as a tenant', () => {
    for (const root of ['https://a.test', 'https://a.test/', 'https://a.test/index.html', 'https://a.test/home']) {
      assert.equal(projectScope(root).ownsAuthority, true, root);
    }
  });
});

describe('a project living under a path on a host it shares', () => {
  const scope = projectScope('https://github.com/affirmitv/ghosthands');

  it('is scoped to its own path, not to the host', () => {
    assert.equal(scope.ownsAuthority, false);
    assert.equal(scope.prefix, '/affirmitv/ghosthands');
  });

  it('admits the pages that really are the project', () => {
    for (const own of [
      'https://github.com/affirmitv/ghosthands',
      'https://github.com/affirmitv/ghosthands/releases',
      'https://github.com/affirmitv/ghosthands/wiki',
      'https://github.com/affirmitv/ghosthands/blob/main/README.md',
    ]) {
      assert.ok(withinScope(own, scope), own);
    }
  });

  it('refuses every page that produced the fabricated contradiction', () => {
    for (const landlord of [
      'https://github.com/pricing',
      'https://github.com/features/copilot',
      'https://skills.github.com/',
      'https://github.com/',
      // The account is not the project.
      'https://github.com/affirmitv',
      // A neighbour under the same host.
      'https://github.com/someone-else/other-repo',
      // Prefix-collision: a longer name that merely starts the same way.
      'https://github.com/affirmitv/ghosthands-docs',
    ]) {
      assert.equal(withinScope(landlord, scope), false, landlord);
    }
  });

  it('drops a landlord link found on the project page before it can be queued', () => {
    const base = 'https://github.com/affirmitv/ghosthands';
    assert.equal(normalise('/pricing', base, scope), null);
    assert.equal(normalise('https://skills.github.com/', base, scope), null);
    assert.equal(
      normalise('/affirmitv/ghosthands/releases', base, scope),
      'https://github.com/affirmitv/ghosthands/releases',
    );
  });

  it('applies the same rule to every other shared host, with no host list anywhere', () => {
    const cases: [string, string, string][] = [
      ['https://gitlab.com/group/proj', 'https://gitlab.com/explore', 'https://gitlab.com/group/proj/-/releases'],
      ['https://huggingface.co/org/model', 'https://huggingface.co/pricing', 'https://huggingface.co/org/model/tree/main'],
      ['https://itch.io/games/thing', 'https://itch.io/developers', 'https://itch.io/games/thing/devlog'],
      ['https://someone.notion.site/Page', 'https://someone.notion.site/Other', 'https://someone.notion.site/Page/sub'],
    ];
    for (const [product, landlord, own] of cases) {
      const s = projectScope(product);
      assert.equal(s.ownsAuthority, false, product);
      assert.equal(withinScope(landlord, s), false, landlord);
      assert.ok(withinScope(own, s), own);
    }
  });
});


describe('the gate gets the real project origin, so P1 is not comparing a value with itself', () => {
  /**
   * V2-C4: `checkPage` used to derive `candidateOrigin` from the URL's own
   * origin on every pipeline call, so P1's same-site clause was `x === x` and
   * only the private-address half of P1 ever did any work. W1 built the
   * parameter; this is the input that makes it fire.
   *
   * Measured against the real gate, one fresh process per case because the
   * verdict cache is keyed on URL alone:
   *   no candidateOrigin  -> https://vercel.com/ ALLOW, P6 robots_wildcard_allow
   *   candidateOrigin set -> https://vercel.com/ DENY,  P1 url_out_of_scope
   *     "vercel.com is not on the candidate's own eTLD+1 (usesesame.app)"
   *
   * Asserted at the source rather than over the network: the property is that
   * the crawl passes its scope, and a network test here would put load on a
   * third party to prove a one-argument wiring.
   */
  it('passes ProjectScope.authority on the crawl path', async () => {
    const crawl = await readFile(new URL('./crawl.ts', import.meta.url), 'utf8');
    assert.match(crawl, /candidateOrigin: scope\.authority/);
  });

  it('carries it all the way through to checkPage', async () => {
    const gate = await readFile(new URL('./gate.ts', import.meta.url), 'utf8');
    const adapter = await readFile(new URL('./gateAdapter.ts', import.meta.url), 'utf8');
    assert.match(gate, /candidateOrigin: options\.candidateOrigin/);
    assert.match(adapter, /candidateOrigin: options\.candidateOrigin/);
  });

  it('records which URL actually served a quote when a redirect moved it', async () => {
    const crawl = await readFile(new URL('./crawl.ts', import.meta.url), 'utf8');
    assert.match(crawl, /kind: 'redirected'/);
    assert.match(crawl, /attributed to the page that served it/);
  });
});
