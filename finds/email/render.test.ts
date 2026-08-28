import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderDigest } from './render.ts';
import type { DigestInput } from './types.ts';

// Rows here are constructed inline for this test only and thrown away --
// per DECISIONS.md D6 this is not a fixture and must never be committed as
// or leak into a real digest. It exists to verify the renderer, nothing
// else reads it.
function sampleInput(): DigestInput {
  return {
    date: '2026-08-28',
    finds: [
      {
        name: 'Test Find & <Co>',
        tagline: 'A tagline with "quotes" to check escaping',
        url: 'https://example.com/product',
        criteria: [
          { id: 'C4', label: 'Agentic / MCP friendly', score: 3, evidence: 'Ships an MCP server, verified by connecting to it.' },
          {
            id: 'C1',
            label: 'Advertised claim verified true',
            score: 1,
            status: 'unsubstantiated',
            evidence: 'Landing page claims X; the site has no other page to check it against.',
          },
          {
            id: 'C2',
            label: 'Solves a rare problem',
            score: 2,
            evidence: 'Capped at 2 under rubric 1.0: nothing on the product’s own site can establish rarity.',
          },
          { id: 'C3', label: 'Usable by any person', score: 3, evidence: 'No account required; tried the flow with no signup.' },
        ],
      },
    ],
  };
}

test('renders criteria in fixed C1..C4 order regardless of input order', () => {
  const { html, text } = renderDigest(sampleInput());
  const order = ['C1', 'C2', 'C3', 'C4'].map((id) =>
    sampleInput().finds[0].criteria.find((c) => c.id === id)!.label,
  );
  const positions = order.map((label) => html.indexOf(label));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(positions.every((p) => p >= 0));

  const textPositions = order.map((label) => text.indexOf(label));
  assert.deepEqual(textPositions, [...textPositions].sort((a, b) => a - b));
});

test('escapes HTML from find data and links only http(s) urls', () => {
  const { html } = renderDigest(sampleInput());
  assert.ok(!html.includes('<Co>'));
  assert.ok(html.includes('&lt;Co&gt;'));
  assert.ok(html.includes('href="https://example.com/product"'));
});

test('refuses to linkify a non-http(s) url', () => {
  const input = sampleInput();
  input.finds[0].url = 'javascript:alert(1)';
  const { html } = renderDigest(input);
  assert.ok(!html.includes('href="javascript:alert(1)"'));
});

test('is honest about zero finds instead of fabricating one', () => {
  const { html, text, subject } = renderDigest({ date: '2026-08-28', finds: [] });
  assert.match(subject, /nothing cleared the bar/);
  assert.match(html, /Nothing cleared the bar today/);
  assert.match(text, /Nothing cleared the bar today/);
});

test('every criterion in the input appears in the plain-text alternative', () => {
  const input = sampleInput();
  const { text } = renderDigest(input);
  for (const c of input.finds[0].criteria) {
    assert.ok(text.includes(c.evidence), `missing evidence for ${c.id} in text part`);
  }
  assert.ok(text.includes(input.finds[0].url));
});

test('C1 unsubstantiated renders as neutral, never as a failure', () => {
  const { html, text } = renderDigest(sampleInput());
  // The negative mark/colour must not appear anywhere for this find: the
  // only non-positive criterion is C1's unsubstantiated, which is neutral.
  assert.ok(!html.includes('class="email-no"'), 'no criterion here is a genuine failure');
  assert.ok(html.includes('Could not verify either way (1/3)'));
  assert.ok(html.includes('class="email-neutral"'));
  assert.ok(text.includes('[~] Advertised claim verified true -- Could not verify either way (1/3)'));
  // The word "fail" must never appear near an unsubstantiated verdict.
  assert.ok(!/fail/i.test(html));
});

test('a rubric-capped C2 (2/3) reads distinctly from a clearly-supported 3/3', () => {
  const { html, text } = renderDigest(sampleInput());
  assert.ok(html.includes('Supported (2/3)'));
  assert.ok(html.includes('Clearly supported (3/3)'));
  assert.notEqual(html.includes('Supported (2/3)'), html.includes('Supported (3/3)'));
  assert.ok(text.includes('Supported (2/3): Capped at 2 under rubric 1.0'));
});

test('a contradicted criterion renders as a clear negative', () => {
  const input = sampleInput();
  input.finds[0].criteria[1] = {
    id: 'C1',
    label: 'Advertised claim verified true',
    score: 0,
    status: 'contradicted',
    evidence: 'The homepage claims free forever; the pricing page requires a card after day 1.',
  };
  const { html, text } = renderDigest(input);
  assert.ok(html.includes('class="email-no"'));
  assert.ok(html.includes('Contradicted (0/3)'));
  assert.ok(text.includes('[!] Advertised claim verified true -- Contradicted (0/3)'));
});
