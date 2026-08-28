/**
 * The only way a find reaches nikhilkulkarni1755.com.
 *
 *   node finds/publish/cli.ts publish --candidate <uuid> --approval <file.json>
 *                                     [--slug <segment>] [--at <iso> | --draft]
 *
 * IT IS NEVER SCHEDULED. Nothing in finds/run/** imports this file and nothing
 * should: the daily workflow ingests, verifies, scores and mails, and stops
 * there. Publishing happens when Nikhil approves one specific find, and only
 * then. That is the same posture D4 fixed for W9's comment path, for the same
 * reason -- this speaks in his name to the public.
 *
 * --approval takes a FILE rather than a flag value so an approval never lands
 * in shell history or an Actions log, and because the file is meant to be the
 * record W8's Telegram poller captured, not something typed by hand. The real
 * guard is in approval.ts: the record must carry the chat id in
 * TELEGRAM_CHAT_ID, which is Nikhil's own chat.
 *
 * Shape of the file (finds/publish/approval.ts, FindApproval):
 *   { "candidate_id": "...", "channel": "telegram", "chat_id": "...",
 *     "message_id": 1234, "answered_at": "...", "answer": "...",
 *     "why_interesting": "his own words, or omit the key" }
 */

import { readFile } from 'node:fs/promises';

import type { FindApproval } from './approval.ts';
import { getSupabaseClient, insertPublished, loadPublishSource, markPublished, takenSlugs } from './db.ts';
import { buildSnapshot } from './snapshot.ts';

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const command = process.argv[2];

if (command === 'publish') {
  const candidateId = flag('candidate');
  const approvalPath = flag('approval');
  if (!candidateId || !approvalPath) {
    die('usage: node finds/publish/cli.ts publish --candidate <uuid> --approval <file.json> [--slug s] [--at <iso> | --draft]');
  }
  const approval = JSON.parse(await readFile(approvalPath, 'utf8')) as FindApproval;

  const at = flag('at');
  const publishedAt = process.argv.includes('--draft') ? null : (at ?? new Date().toISOString());

  const db = getSupabaseClient();
  const source = await loadPublishSource(db, candidateId);
  const result = buildSnapshot(source, {
    approval,
    published_at: publishedAt,
    slug: flag('slug'),
    taken_slugs: await takenSlugs(db),
  });

  if (!result.ok) {
    console.error(`REFUSED to publish ${source.candidate.name}:`);
    for (const refusal of result.refusals) console.error(`  - ${refusal}`);
    process.exit(1);
  }
  for (const note of result.notes) console.error(`  note: ${note}`);

  await insertPublished(db, result.row);
  await markPublished(db, candidateId);
  console.log(
    publishedAt === null
      ? `drafted /interesting-finds/${result.row.slug} -- invisible until published_at is set`
      : `published /interesting-finds/${result.row.slug} at ${publishedAt}`,
  );
} else {
  die('usage: node finds/publish/cli.ts publish --candidate <uuid> --approval <file.json>');
}
