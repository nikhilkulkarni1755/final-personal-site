import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDigest } from './render.ts';
import { sendDigest } from './transport.ts';
import type { DigestInput } from './types.ts';

// The real send path: render a DigestInput and mail it via Gmail SMTP.
// Distinct from dry-run.ts on purpose -- this is the only entry point that
// imports transport.ts, so it is the only place a credential can be used.
//
// Fails loudly and exits non-zero if GMAIL_USER/GMAIL_APP_PASSWORD are
// unset (D6) -- see transport.ts. Never invents input data (D6) -- pass the
// real DigestInput JSON that W5's selection produced.
//
// Usage: node finds/email/send.ts <digest-input.json>

const [, , inputPath] = process.argv;

if (!inputPath) {
  console.error(
    'Usage: node finds/email/send.ts <digest-input.json>\n' +
      'This SENDS the digest. Use finds/email/dry-run.ts to render without sending.',
  );
  process.exit(1);
}

const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as DigestInput;
const rendered = renderDigest(input);

await sendDigest(rendered);
console.log(`[SENT] "${rendered.subject}"`);
