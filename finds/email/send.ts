import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markDigestFailed, markDigestSent, recordDigestAttempt } from './record.ts';
import { renderDigest } from './render.ts';
import { redactSecrets, resolveRecipient, sendDigest } from './transport.ts';
import type { DigestSelection } from './types.ts';

// The real send path: render a DigestSelection, record the attempt, mail it
// via Gmail SMTP, then record the outcome. Distinct from dry-run.ts on
// purpose -- this is the only entry point that imports transport.ts, so it
// is the only place a credential can be used.
//
// Order matters and mirrors finds_digests' own contract (W3, migration
// 20260828210500_create_finds_digests.sql): record as 'pending' first, THEN
// attempt the send, THEN mark 'sent' (with sent_at) or 'failed' (with
// error) -- never pre-mark as sent, and never let a failed send vanish
// without a row. That row is what stops the same find being sent twice
// (finds_digest_items' partial-unique-on-sent index) while also not
// burning a candidate whose send never reached Nikhil.
//
// Fails loudly and exits non-zero if GMAIL_USER/GMAIL_APP_PASSWORD or
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset (D6) -- see transport.ts
// and record.ts. Never invents input data (D6) -- pass the real
// DigestSelection JSON that W5's selection produced.
//
// Usage: node finds/email/send.ts <digest-selection.json>

function fail(message: string): never {
  console.error(redactSecrets(message));
  process.exit(1);
}

const [, , inputPath] = process.argv;

if (!inputPath) {
  fail(
    'Usage: node finds/email/send.ts <digest-selection.json>\n' +
      'This SENDS the digest. Use finds/email/dry-run.ts to render without sending.',
  );
}

const selection = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as DigestSelection;
if (selection.candidateIds.length !== selection.digest.finds.length) {
  fail(
    `candidateIds (${selection.candidateIds.length}) does not match digest.finds ` +
      `(${selection.digest.finds.length}) -- refusing to guess which id belongs to which find.`,
  );
}

const rendered = renderDigest(selection.digest);

let recipient: string;
let digestId: string;
try {
  recipient = resolveRecipient(); // also the credential pre-flight check
  // Nothing has been sent yet at this point. A throw here (missing Gmail or
  // Supabase creds, a DB error) means no digest row exists and nothing was
  // attempted, so there is nothing to mark failed -- just fail cleanly.
  digestId = await recordDigestAttempt({
    subject: rendered.subject,
    recipient,
    candidateIds: selection.candidateIds,
  });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

let sendError: string | undefined;
let providerMessageId: string | undefined;
try {
  ({ providerMessageId } = await sendDigest(rendered));
} catch (err) {
  sendError = redactSecrets(err instanceof Error ? err.message : String(err));
}

if (sendError === undefined) {
  await markDigestSent(digestId, providerMessageId);
  console.log(`[SENT] "${rendered.subject}" (digest ${digestId})`);
} else {
  // The send failed -- record that honestly before exiting non-zero. If
  // *this* write also fails, say both things rather than lose the original
  // error: a digest stuck on 'pending' after a real failure is exactly the
  // silent gap D6 exists to prevent.
  try {
    await markDigestFailed(digestId, sendError);
  } catch (recordErr) {
    const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr);
    fail(`send failed: ${sendError}\nAND failed to record that failure: ${recordMessage}`);
  }
  fail(sendError);
}
