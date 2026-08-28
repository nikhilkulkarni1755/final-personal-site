import nodemailer from 'nodemailer';
import type { RenderedDigest } from './render.ts';

// The only file in this lane that touches SMTP or a credential.
//
// D2: Gmail SMTP with an app password, read at runtime from GMAIL_USER and
// GMAIL_APP_PASSWORD. Never hardcoded, never logged, never echoed.
// Send-only: nodemailer's transport here only ever calls sendMail -- nothing
// in this module reads a mailbox. Exactly one recipient (Nikhil), to keep
// the blast radius of a broad app-password credential small.
//
// D6: if the credential is absent, this throws. It never logs "email sent"
// or "would have sent" and returns success -- see finds/email/dry-run.ts for
// the non-sending render-to-file path instead.

function readCredentials(): { user: string; pass: string } {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'Cannot send the digest: GMAIL_USER and/or GMAIL_APP_PASSWORD are not set. ' +
        'This is a hard stop, not a skip -- set both env vars and re-run. ' +
        'Use finds/email/dry-run.ts to render the digest without sending.',
    );
  }
  return { user, pass };
}

/**
 * The single recipient a real send would use. Exposed so a caller can record
 * it (finds_digests.recipient) before attempting the send -- resolving it
 * also doubles as the same credential check sendDigest does, so a caller
 * fails before writing anything if creds are absent.
 */
export function resolveRecipient(): string {
  const { user } = readCredentials();
  return process.env.DIGEST_TO?.trim() || user;
}

/**
 * Strips every credential this lane holds out of a string before it is
 * logged or stored -- finds_digests.error is a log column (per its
 * migration comment) and D2 forbids the app password appearing in any log;
 * the same discipline applies to the Supabase service role key record.ts
 * uses. Every error that might reach that column -- or a console -- goes
 * through this first.
 */
export function redactSecrets(message: string): string {
  for (const secret of [process.env.GMAIL_APP_PASSWORD, process.env.SUPABASE_SERVICE_ROLE_KEY]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message;
}

export interface SendResult {
  /** Whatever nodemailer's transport returned. Evidence a send really
   * happened, for finds_digests.provider_message_id. */
  providerMessageId: string | undefined;
}

/**
 * Sends the rendered digest to exactly one recipient. Defaults to sending
 * to the sending account itself (GMAIL_USER); set DIGEST_TO to override.
 * Only ever a single address -- never a list.
 */
export async function sendDigest(digest: RenderedDigest): Promise<SendResult> {
  const { user, pass } = readCredentials();
  const to = resolveRecipient();

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const info = await transport.sendMail({
    from: user,
    to,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });

  return { providerMessageId: info.messageId };
}
