// Writes the durable record of Nikhil approving a find (D29,
// finds_approvals). W8 writes; W11 reads. See DEPENDENCIES.md's
// "[PR #38] finds_approvals" entry and finds/publish/approval.ts for the
// read side.
//
// AN APPROVAL ENABLES A PUBLISH; IT NEVER TRIGGERS ONE. This module has no
// scheduling of its own -- it is called only from poll.ts's answer routing,
// itself only run when someone runs `node finds/hitl/poll.ts` by hand or as
// a long-running process. Nothing here belongs in finds/run/**, and nothing
// here should ever be imported from there.
//
// Reuses W2's getSupabaseClient() (finds/sources/db.ts) rather than
// reimplementing a client: one place in the pipeline decides what happens
// when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (D17) are absent, and it
// already fails loud per D6 -- the same pattern W11's db.ts follows.

import type { PostgrestError } from '@supabase/supabase-js';

import { getSupabaseClient } from '../sources/db.ts';
import type { NewApproval } from '../types.ts';
import { requireTelegramEnv } from './config.ts';

export type WriteApprovalResult =
  | { status: 'inserted' }
  /** (chat_id, message_id) already recorded -- Telegram redelivered an
   *  update we already handled (a restart, or our own retry after a
   *  mid-batch failure). Not an error: this is the replay key doing its job. */
  | { status: 'duplicate_message' }
  /** (candidate_id, evidence_run_id) already has a row from a DIFFERENT
   *  message -- a resent digest answered twice. Not an error either: the
   *  find is already approved, this answer just didn't have to do anything. */
  | { status: 'already_approved' };

const UNIQUE_VIOLATION = '23505';

function isConflictOn(error: PostgrestError, constraint: string): boolean {
  return error.code === UNIQUE_VIOLATION && `${error.message} ${error.details ?? ''}`.includes(constraint);
}

/**
 * Insert one approval row.
 *
 * Re-checks `approval.chat_id` against TELEGRAM_CHAT_ID before writing, even
 * though poll.ts has already filtered by chat id before ever calling this --
 * DEPENDENCIES.md is explicit that a table is a wider surface than a file,
 * and W11 does the same re-check on its read side. This should be
 * unreachable in practice; if it isn't, that is a bug in the caller worth
 * failing loudly over, not a case to route around.
 *
 * `ON CONFLICT (chat_id, message_id) DO NOTHING` is expressed as an upsert
 * with `ignoreDuplicates`, which is PostgREST's spelling of the same thing --
 * this is the mechanism that makes a durable getUpdates offset unnecessary
 * (DECISIONS D29): replaying an update after a restart is absorbed here.
 * The second unique key, (candidate_id, evidence_run_id), is NOT the target
 * of that upsert (it protects a different scenario -- two different
 * messages approving the same generation) so a collision on it surfaces as
 * an ordinary unique-violation error, which this function turns into
 * `{ status: 'already_approved' }` instead of letting it look like a crash.
 *
 * Any other error (in particular the FK to finds_verdicts on
 * `(candidate_id, evidence_run_id, approved_criterion)` -- approving a
 * generation that was never scored) is rethrown. That one must stay loud:
 * it means the caller is trying to record consent for something that does
 * not exist.
 */
export async function writeApproval(approval: NewApproval): Promise<WriteApprovalResult> {
  const { chatId } = requireTelegramEnv();
  if (approval.chat_id !== chatId) {
    throw new Error(
      `Refusing to write a finds_approvals row from chat ${approval.chat_id}: does not match ` +
        `TELEGRAM_CHAT_ID. This should be unreachable -- poll.ts must have already dropped it.`,
    );
  }

  const db = getSupabaseClient();
  const { data, error } = await db
    .from('finds_approvals')
    .upsert(approval, { onConflict: 'chat_id,message_id', ignoreDuplicates: true })
    .select('id');

  if (error) {
    if (isConflictOn(error, 'finds_approvals_candidate_run_key')) {
      return { status: 'already_approved' };
    }
    throw new Error(`Writing finds_approvals failed: ${error.message}${error.hint ? ` (${error.hint})` : ''}`);
  }
  // ignoreDuplicates makes PostgREST return no row for a conflicted insert,
  // so an empty result here means the (chat_id, message_id) key already
  // existed -- exactly the replay case this design absorbs on purpose.
  return (data?.length ?? 0) > 0 ? { status: 'inserted' } : { status: 'duplicate_message' };
}
