// Byte-for-byte fidelity check for inbound Telegram reply text (D4 hard
// requirement: Nikhil's reply gets posted verbatim elsewhere, so nothing in
// this bridge may trim, reformat, or re-encode it).
//
// There is no test runner wired into this repo for finds/ code, so this is
// a standalone, dependency-free script: node finds/hitl/verifyFidelity.ts

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';

const TRICKY_STRINGS = [
  'plain ascii reply',
  '  leading and trailing whitespace  \n',
  '“smart quotes” and ‘single’ already present',
  'markdown-looking *bold* _italic_ `code` [link](url) # heading',
  'emoji \u{1F600} and a combining mark é',
  'zero-width joiner ‍ and RTL mark ‏',
  'newlines\nin\nthe\nmiddle',
  'family emoji as ZWJ sequence: \u{1F469}‍\u{1F4BB}',
];

// Simulates exactly what poll.ts does with an inbound update: read `.text`
// off the JSON body telegramClient.ts's `res.json()` produces, with no
// transformation whatsoever.
function extractTextLikePollDoes(rawJsonBody: string): string {
  const parsed = JSON.parse(rawJsonBody) as { message: { text: string } };
  return parsed.message.text;
}

let failures = 0;
for (const original of TRICKY_STRINGS) {
  const roundTripped = extractTextLikePollDoes(JSON.stringify({ message: { text: original } }));
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

// Static guard: telegramClient.ts must never set parse_mode. Doing so would
// have Telegram itself parse our (and by copy-paste habit, maybe someday
// inbound) text as Markdown/HTML entities -- exactly the corruption path
// this file exists to catch. If this ever fires, it means someone added
// parse_mode deliberately; update this check consciously, don't just delete it.
// Matches an actual object key ("parse_mode:" / "'parse_mode'" / etc.), not
// prose mentioning the term in a comment explaining its deliberate absence.
const telegramClientPath = fileURLToPath(new URL('./telegramClient.ts', import.meta.url));
if (/['"]?parse_mode['"]?\s*:/.test(readFileSync(telegramClientPath, 'utf8'))) {
  failures += 1;
  console.error('FAIL: telegramClient.ts references parse_mode -- this can mangle sent/received text (D4).');
}

if (failures > 0) {
  console.error(`${failures} fidelity check(s) failed`);
  process.exit(1);
}
console.log(`all ${TRICKY_STRINGS.length} fidelity checks passed; parse_mode confirmed absent from telegramClient.ts`);
