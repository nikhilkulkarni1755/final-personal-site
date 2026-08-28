// The real send path, and the ONLY entry point in this lane that imports
// peerlistClient.ts. If a file doesn't import this one (directly or
// transitively), it cannot post a comment.
//
// D4's posting guard, restated as code:
//   - explicit invocation only: a real input JSON file naming a real
//     activityId and carrying Nikhil's exact string is required every time
//     (D6: no built-in sample, ever).
//   - `confirm: true` must be present in that file. This is not a second
//     credential check -- it exists so that a dry-run.ts fixture left lying
//     around from testing can never be pointed at this script by accident
//     and produce a real, irreversible, outward-facing post.
//   - exactly one attempt, no retry loop -- see peerlistClient.ts for why a
//     network-ambiguous failure is reported and stopped on, never retried.
//
// Usage: node finds/comment/postComment.ts <input.json>
//   input.json: { "activityId": "PRJ...", "comment": "...", "replyTo": null,
//                 "confirm": true }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCommentPayload } from './payload.ts';
import { postCommentToPeerlist } from './peerlistClient.ts';
import type { PostCommentInput } from './types.ts';

const [, , inputPath] = process.argv;

if (!inputPath) {
  console.error(
    'Usage: node finds/comment/postComment.ts <input.json>\n' +
      'This POSTS a real, irreversible comment under Nikhil\'s Peerlist account.\n' +
      'Use finds/comment/dry-run.ts first to inspect the exact payload.',
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as PostCommentInput & { confirm?: boolean };

if (raw.confirm !== true) {
  console.error(
    `Refusing to post: ${inputPath} does not carry "confirm": true.\n` +
      'This script only ever posts on an explicit, deliberate invocation (D4) -- ' +
      'set confirm to true once you have reviewed the exact string with ' +
      'finds/comment/dry-run.ts and intend to send it now.',
  );
  process.exit(1);
}

const payload = buildCommentPayload(raw);

console.log(`Posting to activityId ${payload.activityId}${payload.replyTo ? ` (reply to ${payload.replyTo})` : ''}...`);
const result = await postCommentToPeerlist(payload);

if (result.outcome === 'posted') {
  console.log(`[POSTED] comment id ${result.commentId}`);
  process.exit(0);
}

// credential_expired / rejected / ambiguous all stop here, loudly, and none
// of them retry -- that decision belongs to a human re-invoking this script
// deliberately, never to this process.
console.error(`[NOT POSTED -- ${result.outcome.toUpperCase()}] ${result.detail}`);
process.exit(1);
