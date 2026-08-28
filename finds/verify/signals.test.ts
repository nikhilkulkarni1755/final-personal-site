/**
 * C2/C3/C4 collection. Inline corpora, thrown away (D6).
 *
 * The property that matters most here is the C4 one: a site advertising a
 * standard that agent-ready-coord R1 §10 established is dead must not come out
 * of this looking agent-friendly.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { collectC2, collectC3, collectC4 } from './signals.ts';
import type { CorpusPage } from './claims.ts';

const kinds = (set: { observations: { kind: string }[] }) => new Set(set.observations.map((o) => o.kind));

describe('C2 -- rare problem', () => {
  it('records the problem statement and who the site says it replaces', () => {
    const corpus: CorpusPage[] = [
      {
        url: 'https://example.test/',
        role: 'homepage',
        text: 'We built this because there was no way to diff two Postgres schemas without a paid seat. Unlike Flyway, it needs no migration history.',
      },
    ];
    const out = collectC2(corpus);
    assert.ok(kinds(out).has('c2_problem_statement'));
    assert.equal(out.observations.find((o) => o.kind === 'c2_named_alternatives')?.value, 1);
    assert.match(out.observations.find((o) => o.kind === 'c2_named_alternatives')!.detail!, /Flyway/);
  });

  it('says so explicitly when nothing was found', () => {
    const out = collectC2([{ url: 'https://example.test/', role: 'homepage', text: 'A very nice product for nice people.' }]);
    assert.ok(kinds(out).has('c2_problem_statement_absent'));
    assert.equal(out.observations.find((o) => o.kind === 'c2_named_alternatives')?.value, 0);
  });
});

describe('C3 -- usable by any person', () => {
  it('records each barrier as a fact with the URL that stated it', () => {
    const corpus: CorpusPage[] = [
      { url: 'https://example.test/', role: 'homepage', text: 'Free tier available. No credit card required to start.' },
      { url: 'https://example.test/docs', role: 'docs', text: 'Install it with npm install -g widget and then run widget init.' },
    ];
    const out = collectC3(corpus);
    assert.equal(out.observations.find((o) => o.kind === 'c3_free_tier')?.value, 'https://example.test/');
    assert.equal(out.observations.find((o) => o.kind === 'c3_terminal_required')?.value, 'https://example.test/docs');
    assert.ok(kinds(out).has('c3_waitlist_absent'));
    assert.equal(out.observations.find((o) => o.kind === 'c3_pricing_page')?.value, null);
    assert.ok(out.quotes.some((q) => q.text.includes('npm install -g widget')));
  });
});

describe('C4 -- agentic / MCP friendly', () => {
  const base: CorpusPage[] = [
    { url: 'https://example.test/docs', role: 'docs', text: 'Connect our MCP server to Claude, or call the REST API directly.' },
  ];

  it('separates a measured llms.txt from a prose mention of MCP', () => {
    const out = collectC4(base, {
      llmsTxt: { url: 'https://example.test/llms.txt', http_status: 200, bytes: 2207 },
      discoveredUrls: ['https://example.test/docs'],
    });
    assert.equal(out.observations.find((o) => o.kind === 'c4_llms_txt')?.value, 2207);
    assert.match(
      out.observations.find((o) => o.kind === 'c4_mcp_endpoint_linked')!.detail!,
      /The mention is a claim, not a measurement/,
    );
    assert.ok(kinds(out).has('c4_openapi_spec_absent'));
    assert.ok(kinds(out).has('c4_webhooks_absent'));
  });

  it('records a 404 on llms.txt rather than dropping the row', () => {
    const out = collectC4(base, {
      llmsTxt: { url: 'https://example.test/llms.txt', http_status: 404, bytes: 0 },
      discoveredUrls: [],
    });
    assert.equal(out.observations.find((o) => o.kind === 'c4_llms_txt_absent')?.value, 404);
  });

  it('refuses to count a dead standard as agent-friendliness', () => {
    const out = collectC4(
      [{ url: 'https://example.test/', role: 'homepage', text: 'Agent ready: we ship a ChatGPT plugin and an agents.json manifest.' }],
      { llmsTxt: null, discoveredUrls: ['https://example.test/.well-known/ai-plugin.json'] },
    );
    const dead = out.observations.filter((o) => o.kind === 'c4_dead_standard_claimed');
    assert.ok(dead.length >= 2, 'both the plugin manifest and agents.json are dead');
    assert.ok(dead.every((o) => /MUST NOT count toward C4/.test(o.detail!)));
  });
});
