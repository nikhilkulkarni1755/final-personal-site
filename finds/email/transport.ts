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
 * Sends the rendered digest to exactly one recipient. Defaults to sending
 * to the sending account itself (GMAIL_USER); set DIGEST_TO to override.
 * Only ever a single address -- never a list.
 */
export async function sendDigest(digest: RenderedDigest): Promise<void> {
  const { user, pass } = readCredentials();
  const to = process.env.DIGEST_TO?.trim() || user;

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  await transport.sendMail({
    from: user,
    to,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });
}
