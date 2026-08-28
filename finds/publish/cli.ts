/**
 * The only way a find reaches nikhilkulkarni1755.com.
 *
 *   node finds/publish/cli.ts publish   --candidate <uuid>
 *                                       [--slug <segment>] [--at <iso> | --draft]
 *   node finds/publish/cli.ts unpublish --slug <segment>
 *
 * IT IS NEVER SCHEDULED. Nothing in finds/run/** imports this file and nothing
 * should: the daily workflow ingests, verifies, scores and mails, and stops
 * there. Publishing happens when Nikhil approves one specific find, and only
 * then. That is the same posture D4 fixed for W9's comment path, for the same
 * reason -- this speaks in his name to the public.
 *
 * THE APPROVAL IS NOT AN ARGUMENT. It is read from `finds_approvals` (D29),
 * the durable record W8's Telegram poller writes. The earlier version of this
 * file took an approval FILE, which was a placeholder for exactly this table
 * and is now gone: two ways to authorise the one irreversible, public-facing
 * action is worse than one, and the file could not carry the replay key, the
 * append-only guarantee or the composite FK that the table does.
 *
 * There is no `--list` and no "what is approved but unpublished" query. W3
 * deliberately withheld that view from the schema because it is the missing
 * ingredient for a three-line cron that auto-publishes, and reimplementing it
 * here in JS would defeat the same reasoning. The candidate id comes from the
 * digest, which is where Nikhil is already looking. The friction is the point.
 */

import {
  getSupabaseClient,
  insertPublished,
  loadApproval,
  loadPublishSource,
  markPublished,
  takenSlugs,
  unpublishBySlug,
} from './db.ts';
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

if (command === 'unpublish') {
  const slug = flag('slug');
  if (!slug) die('usage: node finds/publish/cli.ts unpublish --slug <segment>');
  await unpublishBySlug(getSupabaseClient(), slug);
  console.log(`unpublished ${slug} -- anon can no longer read it. The row and its citations stay.`);
} else if (command === 'publish') {
  const candidateId = flag('candidate');
  if (!candidateId) {
    die('usage: node finds/publish/cli.ts publish --candidate <uuid> [--slug s] [--at <iso> | --draft]');
  }

  const at = flag('at');
  const publishedAt = process.argv.includes('--draft') ? null : (at ?? new Date().toISOString());

  const db = getSupabaseClient();
  const approval = await loadApproval(db, candidateId);
  // The generation HE approved, not the newest one. finds_published is a
  // snapshot of what he agreed to on the day he agreed to it.
  const { source, supersededBy } = await loadPublishSource(db, candidateId, approval.evidence_run_id);
  if (supersededBy) {
    console.error(
      `  note: he approved generation ${approval.evidence_run_id}; ${supersededBy} has been ` +
        `scored since. Publishing what he saw.`,
    );
  }
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
  die('usage: node finds/publish/cli.ts publish --candidate <uuid> | unpublish --slug <segment>');
}
