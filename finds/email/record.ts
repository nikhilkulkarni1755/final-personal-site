import { createClient } from '@supabase/supabase-js';

// Digest bookkeeping against finds_digests / finds_digest_items
// (supabase/migrations/20260828210500_create_finds_digests.sql, W3).
//
// The invariant that matters: a candidate may appear in at most one SENT
// digest. A row that never reaches 'sent' does not burn its candidates, so a
// failed send must still be recorded -- silently losing the attempt (or
// worse, never writing a row and re-sending the same find tomorrow) is
// exactly what that schema exists to prevent.
//
// Sequence a caller must follow (send.ts does): recordDigestAttempt() first
// (creates the 'pending' digest + its items), then attempt the send, then
// markDigestSent() or markDigestFailed() -- never mark 'sent' up front.

function getServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Cannot record the digest: SUPABASE_URL (or VITE_SUPABASE_URL) and/or ' +
        'SUPABASE_SERVICE_ROLE_KEY are not set. Refusing to send without a way ' +
        'to record it -- that is what stops the same find being sent twice.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface DigestAttempt {
  subject: string;
  recipient: string;
  /** finds_candidates.id, in the order they appear in the email. */
  candidateIds: string[];
}

/** Inserts the 'pending' finds_digests row and its finds_digest_items, and
 * returns the new digest id. Nothing here marks anything sent. */
export async function recordDigestAttempt(attempt: DigestAttempt): Promise<string> {
  const supabase = getServiceClient();

  const { data: digestRow, error: digestError } = await supabase
    .from('finds_digests')
    .insert({ subject: attempt.subject, recipient: attempt.recipient })
    .select('id')
    .single();
  if (digestError || !digestRow) {
    throw new Error(`Failed to record the digest attempt: ${digestError?.message ?? 'no row returned'}`);
  }
  const digestId = digestRow.id as string;

  if (attempt.candidateIds.length > 0) {
    const items = attempt.candidateIds.map((candidateId, position) => ({
      digest_id: digestId,
      candidate_id: candidateId,
      position,
    }));
    const { error: itemsError } = await supabase.from('finds_digest_items').insert(items);
    if (itemsError) {
      throw new Error(`Failed to record digest ${digestId}'s items: ${itemsError.message}`);
    }
  }

  return digestId;
}

/** Marks a digest as delivered. Only call this after sendDigest() actually
 * succeeds -- D6 forbids marking 'sent' on anything else. */
export async function markDigestSent(digestId: string, providerMessageId: string | undefined): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('finds_digests')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId ?? null,
    })
    .eq('id', digestId);
  if (error) {
    throw new Error(`Digest ${digestId} sent, but failed to record it as sent: ${error.message}`);
  }
}

/** Marks a digest as failed. `error` must already be redacted (see
 * finds/email/transport.ts's redactSecrets) before it reaches here -- this
 * column is a log, and D2 forbids the app password appearing in one. */
export async function markDigestFailed(digestId: string, error: string): Promise<void> {
  const supabase = getServiceClient();
  const { error: updateError } = await supabase
    .from('finds_digests')
    .update({ status: 'failed', error })
    .eq('id', digestId);
  if (updateError) {
    throw new Error(
      `Digest ${digestId} failed (${error}), and failed to record that too: ${updateError.message}`,
    );
  }
}
