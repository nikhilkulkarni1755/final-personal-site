/**
 * The rules that decide whether something appears on Nikhil's site.
 *
 * D6: every shape here is constructed inline and thrown away. There is no
 * fixture file, nothing reaches a database, and nothing here can leak into
 * production. The chat id and the .invalid hosts (RFC 2606, can never resolve)
 * exist only inside this process.
 *
 * The first test is the one that matters: it is DECISIONS D23's real incident,
 * replayed. github.com/affirmitv/ghosthands was scored on 23 pages GitHub Inc.
 * wrote, and a real project's README claim was recorded as CONTRADICTED by a
 * sentence on github.com/pricing. If that had reached this lane it would have
 * been a false accusation against a named third party on Nikhil's own domain.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GateUseRights } from '../types.ts';
import type { FindApproval } from './approval.ts';
import { buildSnapshot, slugify, type PublishOptions } from './snapshot.ts';
import type { CandidateCitation, PublishSource } from './types.ts';

const CHAT = '11223344';
process.env.TELEGRAM_CHAT_ID = CHAT;

const CANDIDATE = '00000000-0000-4000-8000-00000000000a';

const OPEN: GateUseRights = {
  llm_ingest: true,
  publish_excerpt: true,
  publish_link: true,
  follow_links: true,
  store_raw_body: true,
  train: false,
  max_snippet_chars: null,
  reserved_by: [],
};

const approval = (over: Partial<FindApproval> = {}): FindApproval => ({
  candidate_id: CANDIDATE,
  channel: 'telegram',
  chat_id: CHAT,
  message_id: 42,
  answered_at: '2026-08-28T21:00:00.000Z',
  answer: 'publish it',
  ...over,
});

const cite = (criterion: CandidateCitation['criterion'], url: string, over: Partial<CandidateCitation> = {}): CandidateCitation => ({
  criterion,
  url,
  quote: 'runs entirely offline',
  stance: 'supports',
  use_rights: OPEN,
  ...over,
});

function source(productUrl: string, citations: CandidateCitation[], name = 'Ghosthands'): PublishSource {
  return {
    candidate: {
      id: CANDIDATE,
      name,
      tagline: 'hands-free terminal',
      product_url: productUrl,
      first_seen_at: '2026-08-28T09:00:00.000Z',
    },
    source_labels: ['GitHub'],
    evidence_run_id: '00000000-0000-4000-8000-00000000000b',
    scores: [
      { criterion: 'C1', score: 2 },
      { criterion: 'C2', score: 1 },
      { criterion: 'C3', score: 2 },
      { criterion: 'C4', score: 3 },
    ],
    citations,
  };
}

const options = (over: Partial<PublishOptions> = {}): PublishOptions => ({
  approval: approval(),
  published_at: '2026-08-28T21:05:00.000Z',
  ...over,
});

const allFour = (host: string): CandidateCitation[] => [
  cite('C1', `${host}/`),
  cite('C2', `${host}/`),
  cite('C3', `${host}/`),
  cite('C4', `${host}/`),
];

/* -- D23, the incident that created this lane ---------------------------- */

test('D23: a shared-host tenant may not be judged on the host own pages', () => {
  const repo = 'https://github.com/affirmitv/ghosthands';
  const result = buildSnapshot(
    source(repo, [
      cite('C1', 'https://github.com/pricing', { quote: 'Start a free 30 day trial today', stance: 'contradicts' }),
      cite('C2', `${repo}/blob/main/README.md`),
      cite('C3', `${repo}/blob/main/README.md`),
      cite('C4', 'https://github.com/features/copilot'),
    ]),
    options(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.refusals.some((r) => r.includes('github.com/pricing') && r.includes('D23')));
  assert.ok(result.refusals.some((r) => r.includes('github.com/features/copilot')));
});

test('D23: the same repo publishes when every citation is inside its own subtree', () => {
  const repo = 'https://github.com/affirmitv/ghosthands';
  const result = buildSnapshot(source(repo, allFour(repo)), options());
  assert.equal(result.ok, true);
  assert.equal(result.row.slug, 'ghosthands');
  assert.equal(result.row.score_agentic_friendly, 3);
  assert.equal(result.row.citations.length, 4);
});

test('a product on its own domain is in scope across that whole domain', () => {
  const result = buildSnapshot(
    source('https://w11-own.invalid/', [
      cite('C1', 'https://w11-own.invalid/docs'),
      cite('C2', 'https://www.w11-own.invalid/about'),
      cite('C3', 'http://w11-own.invalid/pricing'),
      cite('C4', 'https://w11-own.invalid/mcp'),
    ]),
    options(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('a citation from a different host is refused however plausible', () => {
  const result = buildSnapshot(
    source('https://w11-own.invalid/', [...allFour('https://w11-own.invalid'), cite('C4', 'https://skills.github.com/x')]),
    options(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.refusals[0].includes('skills.github.com'));
});

/* -- USE rights: what we may fetch is not what we may republish ----------- */

test('publish_excerpt false drops the quote and keeps the link', () => {
  const nosnippet: GateUseRights = { ...OPEN, publish_excerpt: false };
  const result = buildSnapshot(
    source('https://w11-own.invalid/', [
      cite('C1', 'https://w11-own.invalid/legal', { use_rights: nosnippet }),
      cite('C2', 'https://w11-own.invalid/'),
      cite('C3', 'https://w11-own.invalid/'),
      cite('C4', 'https://w11-own.invalid/'),
    ]),
    options(),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.row.citations[0], {
    criterion: 'C1',
    url: 'https://w11-own.invalid/legal',
    stance: 'supports',
  });
  assert.ok(result.notes[0].includes('refuse a public excerpt'));
});

test('a quote longer than the site snippet limit is dropped, never truncated', () => {
  const limited: GateUseRights = { ...OPEN, max_snippet_chars: 5 };
  const result = buildSnapshot(
    source('https://w11-own.invalid/', [
      cite('C1', 'https://w11-own.invalid/a', { use_rights: limited }),
      cite('C2', 'https://w11-own.invalid/'),
      cite('C3', 'https://w11-own.invalid/'),
      cite('C4', 'https://w11-own.invalid/'),
    ]),
    options(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.row.citations[0].quote, undefined);
  assert.ok(result.notes[0].includes('a trimmed quote is a misquote'));
});

test('publish_link false drops the citation, and D7 then refuses the bare score', () => {
  const noLink: GateUseRights = { ...OPEN, publish_link: false };
  const result = buildSnapshot(
    source('https://w11-own.invalid/', [
      cite('C1', 'https://w11-own.invalid/a', { use_rights: noLink }),
      cite('C2', 'https://w11-own.invalid/'),
      cite('C3', 'https://w11-own.invalid/'),
      cite('C4', 'https://w11-own.invalid/'),
    ]),
    options(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.refusals[0].startsWith('C1 would be published with no evidence'));
});

test('a cited page with no recorded USE rights refuses rather than assuming permission', () => {
  const result = buildSnapshot(
    source('https://w11-own.invalid/', [
      cite('C1', 'https://w11-own.invalid/a', { use_rights: {} }),
      cite('C2', 'https://w11-own.invalid/'),
      cite('C3', 'https://w11-own.invalid/'),
      cite('C4', 'https://w11-own.invalid/'),
    ]),
    options(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.refusals[0].includes('no recorded USE rights'));
});

/* -- approval: the only thing that may cause a public statement ----------- */

test('an approval from another chat is refused', () => {
  assert.throws(
    () =>
      buildSnapshot(
        source('https://w11-own.invalid/', allFour('https://w11-own.invalid')),
        options({ approval: approval({ chat_id: '99999999' }) }),
      ),
    /not the allowlisted chat/,
  );
});

test('an approval for another find is refused', () => {
  assert.throws(
    () =>
      buildSnapshot(
        source('https://w11-own.invalid/', allFour('https://w11-own.invalid')),
        options({ approval: approval({ candidate_id: '00000000-0000-4000-8000-0000000000ff' }) }),
      ),
    /never transferable/,
  );
});

test('with no allowlist configured nothing can be published at all', () => {
  delete process.env.TELEGRAM_CHAT_ID;
  try {
    assert.throws(
      () => buildSnapshot(source('https://w11-own.invalid/', allFour('https://w11-own.invalid')), options()),
      /TELEGRAM_CHAT_ID is not set/,
    );
  } finally {
    process.env.TELEGRAM_CHAT_ID = CHAT;
  }
});

/* -- the rest ------------------------------------------------------------- */

test('why_interesting is his own words or nothing -- never the button he tapped', () => {
  const tapped = buildSnapshot(source('https://w11-own.invalid/', allFour('https://w11-own.invalid')), options());
  assert.equal(tapped.ok, true);
  assert.equal(tapped.row.why_interesting, null);

  const wrote = buildSnapshot(
    source('https://w11-own.invalid/', allFour('https://w11-own.invalid')),
    options({ approval: approval({ why_interesting: 'first tool that got  <this>  right\nfinally' }) }),
  );
  assert.equal(wrote.ok, true);
  assert.equal(wrote.row.why_interesting, 'first tool that got  <this>  right\nfinally');
});

test('a criterion with no score refuses -- the page shows all four', () => {
  const s = source('https://w11-own.invalid/', allFour('https://w11-own.invalid'));
  s.scores = s.scores.filter((v) => v.criterion !== 'C2');
  const result = buildSnapshot(s, options());
  assert.equal(result.ok, false);
  assert.ok(result.refusals[0].includes('no score for C2'));
});

test('a slug already in use refuses instead of renaming a live URL', () => {
  const result = buildSnapshot(
    source('https://w11-own.invalid/', allFour('https://w11-own.invalid')),
    options({ taken_slugs: ['ghosthands'] }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.refusals[0].includes('already published'));
});

test('slugs match the column CHECK, and a name with nothing sluggable refuses', () => {
  assert.equal(slugify('Forth MCP — local MCP servers!'), 'forth-mcp-local-mcp-servers');
  assert.equal(slugify('Café Wörks'), 'cafe-works');
  const result = buildSnapshot(
    source('https://w11-own.invalid/', allFour('https://w11-own.invalid'), '思考'),
    options(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.refusals[0].includes('not a usable URL segment'));
});

test('drafting and scheduling both leave the row invisible, with no status column', () => {
  const draft = buildSnapshot(
    source('https://w11-own.invalid/', allFour('https://w11-own.invalid')),
    options({ published_at: null }),
  );
  assert.equal(draft.ok, true);
  assert.equal(draft.row.published_at, null);

  const scheduled = buildSnapshot(
    source('https://w11-own.invalid/', allFour('https://w11-own.invalid')),
    options({ published_at: '2099-01-01T00:00:00.000Z' }),
  );
  assert.equal(scheduled.ok, true);
  assert.equal(scheduled.row.published_at, '2099-01-01T00:00:00.000Z');
});
