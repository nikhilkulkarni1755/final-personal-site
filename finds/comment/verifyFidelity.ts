// Fidelity check for the outbound comment string, updated per DECISIONS
// D13: Peerlist's comment field is HTML (R1-sources.md §1.8 captured a
// live comment as `"<p>This seems really cool </p>"`), so literal
// byte-for-byte transmission of plain text would CORRUPT what Nikhil wrote
// -- his line breaks would vanish and a `<` he typed would be swallowed as
// markup. D4's actual point is that what he writes is what a reader sees,
// so this proves fidelity of the RENDERED RESULT, not raw wire bytes. W8
// solved the equivalent problem for inbound Telegram text in
// finds/hitl/verifyFidelity.ts; this is the outbound-leg equivalent,
// written independently (different lane, different ownership -- not
// imported from there).
//
// No test runner is wired up for finds/ code, so this is a standalone,
// dependency-free script: node finds/comment/verifyFidelity.ts
//
// Scope note: this proves fidelity of the bytes THIS TRANSPORT sends and of
// what a standards-conforming HTML renderer would show for them. It cannot
// prove what Peerlist's own backend does with them after receipt (further
// server-side sanitisation is plausible and outside our control).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { encodeCommentAsHtml } from './htmlEncode.ts';
import { buildCommentPayload } from './payload.ts';

const TRICKY_STRINGS = [
  'plain ascii comment',
  '  leading and trailing whitespace  \n',
  '“smart quotes” and ‘single’ already present',
  'markdown-looking *bold* _italic_ `code` [link](url) # heading',
  // The whole point of D13: this must render with the angle brackets and
  // ampersand VISIBLE to a reader, not interpreted as markup.
  '<p>HTML-lookalike</p> & an ampersand & <script>not executed, just literal text</script>',
  // "e" + combining acute accent (U+0301), NOT the single precomposed
  // "é" codepoint -- proves nothing here runs .normalize('NFC'/'NFKC').
  `emoji 😀 and a combining mark e${'́'}`,
  'zero-width joiner ‍ and RTL mark ‏',
  'newlines\nin\nthe\nmiddle',
  'CRLF line ending\r\nrenders as the same line break as LF',
  'family emoji as ZWJ sequence: \u{1F469}‍\u{1F4BB}',
];

/**
 * Inverse of htmlEncode.ts's encodeCommentAsHtml, for THIS TEST ONLY: it
 * only has to undo exactly what that function does (one <p>/<br> wrapper,
 * five entities), not parse arbitrary HTML. Simulates "what does a reader
 * actually see", which is the thing D13 says must match what Nikhil typed.
 */
function decodeRenderedComment(html: string): string {
  const inner = html.replace(/^<p>/, '').replace(/<\/p>$/, '');
  const withLineBreaks = inner.replace(/<br>/g, '\n');
  return withLineBreaks
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&'); // must be last, or a decoded &lt; could be re-mangled
}

/** D13 is explicit that CRLF/LF/CR all render as the same visual line break. */
function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\n');
}

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

for (const original of TRICKY_STRINGS) {
  // 1. Full pipeline: what postComment.ts actually builds and would send.
  const payload = buildCommentPayload({ activityId: 'PRJTEST00000000000000000000', comment: original });
  const rendered = payload.comment;

  // 2. What a reader would see: decode the rendered HTML back to text and
  //    compare against what Nikhil typed (line-break style normalised,
  //    since D13 only requires the BREAK to survive, not the CRLF/LF byte).
  const decoded = decodeRenderedComment(rendered);
  try {
    assert.strictEqual(decoded, normalizeLineBreaks(original), 'rendered result does not match what Nikhil typed');
  } catch (err) {
    fail(`${JSON.stringify(original)} -> rendered ${JSON.stringify(rendered)}: ${(err as Error).message}`);
    continue;
  }

  // 3. No raw `<` or `>` may survive outside the three structural tags we
  //    intentionally emit -- that is the concrete "a `<` he typed doesn't
  //    get swallowed as markup" guarantee.
  const withoutOurStructuralTags = rendered.replace(/<\/?p>|<br>/g, '');
  if (/[<>]/.test(withoutOurStructuralTags)) {
    fail(`${JSON.stringify(original)} -> rendered ${JSON.stringify(rendered)}: unescaped angle bracket leaked out`);
  }
}

// Explicit checks called out by name in DECISIONS D13, on top of the
// generic round-trip above:
assert.ok(encodeCommentAsHtml('two\nlines').includes('<br>'), 'a multi-line string must produce a <br>');
assert.strictEqual(
  decodeRenderedComment(encodeCommentAsHtml('line one\nline two')),
  'line one\nline two',
  'line breaks must be recoverable exactly',
);
const quoteAndEmoji = '“curly” and \u{1F469}‍\u{1F4BB}';
assert.strictEqual(
  decodeRenderedComment(encodeCommentAsHtml(quoteAndEmoji)),
  quoteAndEmoji,
  'smart quotes and a ZWJ emoji sequence must pass through unmangled',
);

// Static guards: read the actual source so a future "just a little
// cleanup" edit fails this script instead of silently shipping.
function readLaneFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// payload.ts must perform ZERO string mutation of its own -- the one
// permitted exception (escape-and-wrap) is fully delegated to
// htmlEncode.ts, so this file can be held to a much stricter bar.
const payloadSrc = stripLineComments(readLaneFile('./payload.ts'));
const FORBIDDEN_IN_PAYLOAD =
  /\.(trim|trimStart|trimEnd|normalize|replace|replaceAll|toLowerCase|toUpperCase|toWellFormed)\s*\(/;
if (FORBIDDEN_IN_PAYLOAD.test(payloadSrc)) {
  fail('payload.ts references a string-mutating method directly -- it must delegate entirely to htmlEncode.ts.');
}

// htmlEncode.ts is allowed its two audited .replace() calls (that's its
// whole job) but never a normalisation or case/trim change.
const htmlEncodeSrc = stripLineComments(readLaneFile('./htmlEncode.ts'));
const FORBIDDEN_IN_ENCODER = /\.(trim|trimStart|trimEnd|normalize|toLowerCase|toUpperCase|toWellFormed)\s*\(/;
if (FORBIDDEN_IN_ENCODER.test(htmlEncodeSrc)) {
  fail('htmlEncode.ts references trim/normalize/case-folding -- D13 permits escaping only, nothing else.');
}

const clientSrc = stripLineComments(readLaneFile('./peerlistClient.ts'));
if (/payload\.comment/.test(clientSrc)) {
  fail(
    'peerlistClient.ts touches payload.comment directly -- it must only forward the whole payload object ' +
      'opaquely to JSON.stringify, never read or rebuild the comment field itself.',
  );
}

// D6/D4 guard borrowed from W6's dry-run convention: the dry-run entry point
// must be structurally incapable of posting, which means it can never import
// the transport module, not just "choose" not to call it.
const dryRunSrc = readLaneFile('./dry-run.ts');
if (/from ['"]\.\/peerlistClient\.ts['"]/.test(dryRunSrc)) {
  fail('dry-run.ts imports peerlistClient.ts -- it must be structurally incapable of posting.');
}

if (failures > 0) {
  console.error(`${failures} fidelity check(s) failed`);
  process.exit(1);
}
console.log(
  `all ${TRICKY_STRINGS.length} rendered-result checks passed (D13); payload.ts confirmed to delegate all ` +
    'encoding to htmlEncode.ts; htmlEncode.ts confirmed escape-only (no trim/normalize/case-fold); ' +
    'peerlistClient.ts confirmed to forward comment opaquely; dry-run.ts confirmed to not import the transport.',
);
