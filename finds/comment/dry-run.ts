// Dry-run CLI: shows exactly what would be POSTed to Peerlist, and sends
// nothing. Structurally incapable of posting -- it imports only the pure
// payload builder, never peerlistClient.ts (the one file that touches
// Playwright, the credential, or the network). Modeled on
// finds/email/dry-run.ts's same guarantee for W6.
//
// Per D6 there is no built-in sample comment: a real PostCommentInput JSON
// file is required every time.
//
// Usage: node finds/comment/dry-run.ts <input.json>
//   input.json: { "activityId": "PRJ...", "comment": "...", "replyTo": null }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCommentPayload } from './payload.ts';
import type { PostCommentInput } from './types.ts';

const [, , inputPath] = process.argv;

if (!inputPath) {
  console.error(
    'Usage: node finds/comment/dry-run.ts <input.json>\n' +
      'Builds and prints the exact Peerlist comment payload. NOTHING IS SENT --\n' +
      'this script never imports the network transport.',
  );
  process.exit(1);
}

const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as PostCommentInput;
const payload = buildCommentPayload(input);

console.log('[DRY RUN -- NOT SENT, no credential read, no network reached]');
console.log(`  target activityId: ${payload.activityId}`);
console.log(`  replyTo:           ${payload.replyTo ?? '(top-level comment)'}`);
console.log(`  comment (repr):    ${JSON.stringify(payload.comment)}`);
console.log(`  comment (raw):\n${payload.comment}`);
console.log(`  utf-8 byte length: ${Buffer.byteLength(payload.comment, 'utf8')}`);
console.log('  exact JSON body that a real post would send:');
console.log(`  ${JSON.stringify(payload)}`);
