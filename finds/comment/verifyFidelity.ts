// Byte-for-byte fidelity check for the outbound comment string (D4 hard
// requirement: "it should take my string and post it as is. no cleanup
// etc." -- nothing in this transport may trim, reformat, escape, wrap, or
// re-encode it). W8 solved the equivalent problem for inbound Telegram text
// in finds/hitl/verifyFidelity.ts; this is the equivalent proof for W9's
// outbound leg, written independently (different lane, different
// ownership -- not imported from there).
//
// No test runner is wired up for finds/ code, so this is a standalone,
// dependency-free script: node finds/comment/verifyFidelity.ts
//
// Important scope note: this proves fidelity of the bytes THIS TRANSPORT
// sends. It cannot prove what Peerlist's own backend does with them after
// receipt (e.g. server-side HTML sanitisation is plausible and outside our
// control) -- see the comment on HTML_LOOKALIKE below.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { buildCommentPayload } from './payload.ts';

const TRICKY_STRINGS = [
  'plain ascii comment',
  '  leading and trailing whitespace  \n',
  '“smart quotes” and ‘single’ already present',
  'markdown-looking *bold* _italic_ `code` [link](url) # heading',
  // D4 says post as-is, not "post as safe plain text" -- so a string that
  // looks like markup must ALSO survive untouched, un-escaped, un-stripped.
  '<p>HTML-lookalike</p> & an ampersand & <script>not executed, just bytes</script>',
  'emoji \u{1F600} and a combining mark é',
  'zero-width joiner ‍ and RTL mark ‏',
  'newlines\nin\nthe\nmiddle',
  'CRLF line ending\r\nstays CRLF',
  'family emoji as ZWJ sequence: \u{1F469}‍\u{1F4BB}',
];

// Simulates the whole outbound path with no network: build the payload the
// way postComment.ts does, then round-trip it through JSON exactly as it
// will cross the wire in the real POST body (peerlistClient.ts does nothing
// to `payload` but JSON.stringify it).
function roundTripLikeThePostDoes(original: string): string {
  const payload = buildCommentPayload({ activityId: 'PRJTEST00000000000000000000', comment: original });
  const wireBytes = JSON.stringify(payload);
  const received = JSON.parse(wireBytes) as { comment: string };
  return received.comment;
}

let failures = 0;
for (const original of TRICKY_STRINGS) {
  const roundTripped = roundTripLikeThePostDoes(original);
  try {
    assert.strictEqual(roundTripped, original, 'string identity broke');
    assert.strictEqual(
      Buffer.byteLength(roundTripped, 'utf8'),
      Buffer.byteLength(original, 'utf8'),
      'utf8 byte length changed',
    );
  } catch (err) {
    failures += 1;
    console.error(`FAIL: ${JSON.stringify(original)} -> ${JSON.stringify(roundTripped)}: ${(err as Error).message}`);
  }
}

// Static guards: read the actual source of the two files that touch the
// comment string end to end, and refuse to pass if either one so much as
// mentions a transform. This catches a future edit that adds "just a little
// cleanup" long before it ships, not just today's version of the files.
function readLaneFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

// Strip comment lines first -- payload.ts's own header explains, in prose,
// which methods it does NOT call, and those method names would otherwise
// trip this same regex.
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const payloadSrc = stripLineComments(readLaneFile('./payload.ts'));
const FORBIDDEN_TRANSFORMS = /\.(trim|trimStart|trimEnd|normalize|replace|replaceAll|toLowerCase|toUpperCase|toWellFormed)\s*\(/;
if (FORBIDDEN_TRANSFORMS.test(payloadSrc)) {
  failures += 1;
  console.error('FAIL: payload.ts references a string-mutating method -- D4 requires zero transformation.');
}

const clientSrc = readLaneFile('./peerlistClient.ts');
if (/payload\.comment/.test(clientSrc)) {
  failures += 1;
  console.error(
    'FAIL: peerlistClient.ts touches payload.comment directly -- it must only forward the whole ' +
      'payload object opaquely to JSON.stringify, never read or rebuild the comment field itself.',
  );
}

// D6/D4 guard borrowed from W6's dry-run convention: the dry-run entry point
// must be structurally incapable of posting, which means it can never import
// the transport module, not just "choose" not to call it.
const dryRunSrc = readLaneFile('./dry-run.ts');
if (/from ['"]\.\/peerlistClient\.ts['"]/.test(dryRunSrc)) {
  failures += 1;
  console.error('FAIL: dry-run.ts imports peerlistClient.ts -- it must be structurally incapable of posting.');
}

if (failures > 0) {
  console.error(`${failures} fidelity check(s) failed`);
  process.exit(1);
}
console.log(
  `all ${TRICKY_STRINGS.length} fidelity checks passed; payload.ts confirmed transform-free; ` +
    'peerlistClient.ts confirmed to forward comment opaquely; dry-run.ts confirmed to not import the transport.',
);
