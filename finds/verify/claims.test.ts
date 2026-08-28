/**
 * C1 is the criterion the whole system turns on, so the property under test is
 * the one that would do real damage if it were wrong: unsubstantiated must
 * never be reported as contradicted.
 *
 * The HTML here is constructed inline and thrown away (D6). It is not a
 * fixture of any real product and no quote in it is attributed to anyone.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { diffClaims, extractClaims, keyTerms } from './claims.ts';
import { pageRole, parsePage } from './extract.ts';

const landing = parsePage(`
  <html><head>
    <title>Widget</title>
    <meta name="description" content="Turns spreadsheets into typed GraphQL endpoints in one click.">
  </head><body>
    <h1>Turn any spreadsheet into a typed GraphQL endpoint</h1>
    <h2>Free forever for personal projects</h2>
    <ul><li>Available now &mdash; no waitlist</li><li>Open source under the MIT licence</li></ul>
    <script>console.log("not text")</script>
  </body></html>`);

describe('C1 claim extraction', () => {
  it('takes the claims verbatim off the landing page and classifies them', () => {
    const claims = extractClaims(landing);
    const byKind = Object.fromEntries(claims.map((c) => [c.kind, c.text]));

    assert.equal(byKind.capability, 'Turns spreadsheets into typed GraphQL endpoints in one click.');
    assert.equal(claims[0]!.text, 'Turn any spreadsheet into a typed GraphQL endpoint');
    assert.equal(claims[0]!.locator, 'h1');
    assert.equal(claims.length, 5, 'the whole page body is not a sixth claim');
    assert.equal(byKind.free, 'Free forever for personal projects');
    assert.equal(byKind.open_source, 'Open source under the MIT licence');
    assert.ok(claims.every((c) => landing.text.includes(c.text) || c.locator === 'meta[name=description]'));
    assert.ok(!claims.some((c) => c.text.includes('not text')), 'script contents are not claims');
  });

  it('decodes entities rather than quoting raw markup', () => {
    assert.ok(landing.listItems[0]?.includes('—'));
  });
});

describe('C1 diff', () => {
  const claims = extractClaims(landing);

  it('reports a claim nothing speaks to as unsubstantiated, not as false', () => {
    const diff = diffClaims(claims, [{ url: 'https://example.test/about', role: 'about', text: 'We are a team of three in Lisbon.' }]);
    const kinds = new Set(diff.observations.map((o) => o.kind));
    assert.ok(kinds.has('c1_unsubstantiated'));
    assert.ok(!kinds.has('c1_contradicted'), 'silence is never a contradiction');
    assert.match(
      diff.observations.find((o) => o.kind === 'c1_unsubstantiated')!.detail!,
      /Unsubstantiated is not false/,
    );
  });

  it('quotes the corroborating sentence with the URL it came from', () => {
    const diff = diffClaims(claims, [
      {
        url: 'https://example.test/docs',
        role: 'docs',
        text: 'Point it at a spreadsheet and it generates a typed GraphQL endpoint you can query immediately.',
      },
    ]);
    const corroborated = diff.observations.find((o) => o.kind === 'c1_corroborated');
    assert.ok(corroborated, 'a docs page echoing the hero claim corroborates it');
    assert.equal(corroborated.value, 'https://example.test/docs');
    const quote = diff.quotes.find((q) => q.locator?.startsWith('https://example.test/docs'));
    assert.ok(quote && quote.text.includes('typed GraphQL endpoint'));
  });

  it('contradicts an availability claim only on an unambiguous phrase', () => {
    const diff = diffClaims(claims, [
      { url: 'https://example.test/pricing', role: 'pricing', text: 'Join the waitlist and we will email you when a slot opens.' },
    ]);
    const contradicted = diff.observations.filter((o) => o.kind === 'c1_contradicted');
    assert.equal(contradicted.length, 1);
    assert.match(contradicted[0]!.detail!, /availability/);
    assert.equal(contradicted[0]!.value, 'https://example.test/pricing');
  });
});

describe('supporting parts', () => {
  it('drops marketing filler from a claim key terms', () => {
    assert.deepEqual(keyTerms('Simply build faster with your free tool').sort(), ['tool']);
  });

  it('names what a page is from its path', () => {
    assert.equal(pageRole('https://example.test/'), 'homepage');
    assert.equal(pageRole('https://example.test/pricing'), 'pricing');
    assert.equal(pageRole('https://example.test/docs/getting-started'), 'docs');
    assert.equal(pageRole('https://example.test/docs/mcp-server'), 'mcp');
    assert.equal(pageRole('https://example.test/llms.txt'), 'llms_txt');
    assert.equal(pageRole('https://github.com/acme/widget'), 'repo');
    assert.equal(pageRole('https://example.test/careers'), 'other');
  });
});
