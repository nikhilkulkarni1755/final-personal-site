import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { markDigestFailed, markDigestSent, recordDigestAttempt } from './record.ts';

// No real Supabase instance in this test -- these only verify the credential
// guard fails loud (D6) rather than silently proceeding. A live round-trip
// against finds_digests belongs to V1 (end-to-end), once SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY exist somewhere to test against.

let savedUrl: string | undefined;
let savedViteUrl: string | undefined;
let savedKey: string | undefined;

before(() => {
  savedUrl = process.env.SUPABASE_URL;
  savedViteUrl = process.env.VITE_SUPABASE_URL;
  savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

after(() => {
  if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
  if (savedViteUrl !== undefined) process.env.VITE_SUPABASE_URL = savedViteUrl;
  if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
});

test('recordDigestAttempt refuses to proceed without Supabase credentials', async () => {
  await assert.rejects(
    () => recordDigestAttempt({ subject: 'x', recipient: 'nikhil@example.com', candidateIds: [] }),
    /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/s,
  );
});

test('markDigestSent refuses to proceed without Supabase credentials', async () => {
  await assert.rejects(() => markDigestSent('00000000-0000-0000-0000-000000000000', 'msg-1'));
});

test('markDigestFailed refuses to proceed without Supabase credentials', async () => {
  await assert.rejects(() => markDigestFailed('00000000-0000-0000-0000-000000000000', 'some error'));
});
