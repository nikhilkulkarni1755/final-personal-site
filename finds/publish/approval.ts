/**
 * The one thing that may cause a public statement to appear on Nikhil's domain.
 *
 * HARD RULE FOR THIS LANE: nothing is published without Nikhil's explicit,
 * per-find approval. Not a high score, not a threshold, not "he approved
 * similar ones", not a batch. A row in finds_published is a public claim about
 * someone else's product, on his personal site, under his name.
 *
 * DECISIONS D9 settles where that approval comes from: email is the digest and
 * is READ-ONLY; Telegram is the control surface, authenticated and restricted
 * to one chat id. So an approval this lane will act on is a Telegram answer
 * from Nikhil's own chat, and nothing else is representable -- `channel` has
 * exactly one member on purpose.
 *
 * THE ALLOWLIST IS CHECKED AGAIN HERE, not trusted from upstream. W8's poller
 * already drops messages from foreign chats; this asserts it a second time at
 * the moment of publication, because the cost of being wrong is different here
 * than anywhere else in the pipeline. Defence in depth, same posture as
 * scope.ts.
 *
 * WHERE AN APPROVAL NOW LIVES: `finds_approvals` (D29, W3's migration
 * 20260828211200). W8's poller writes a row; this reads one. The lane's own
 * `FindApproval` shape is gone -- W3 shipped `ApprovalRow` and a local
 * duplicate would be a second thing to drift.
 *
 * Two of W3's sharpenings matter to the code below:
 *   * the replay key is `(chat_id, message_id)`, not `(candidate_id,
 *     message_id)` -- message_id is Telegram's PER-CHAT counter, not a global
 *     id. That key is what makes the durable-approval / disposable-offset split
 *     work at all, so it had to be right.
 *   * `evidence_run_id` records WHICH EVIDENCE HE SAW, and a composite FK makes
 *     approving a never-scored generation impossible. Asserted here too: he
 *     approves a find on the strength of what the digest showed him, and a
 *     re-crawl afterwards must not slip evidence he never read onto the page.
 *
 * THERE IS NO revoked_at, and this module does not check for one. W3 declined
 * the column on the grounds that a revocation no reader consults looks like a
 * safeguard while being none, and the takedown path already holds a change of
 * mind. Agreed: an approval is a receipt for something a person said at a
 * moment, and the honest place for "I changed my mind" is
 * `published_at = NULL`, which takes the page down whether or not the publish
 * has already happened.
 */

import type { ApprovalRow } from '../types.ts';

/**
 * Throws unless this approval is Nikhil's, for this find, on this generation.
 * Every failure is a hard stop with a specific message -- per D6 there is no
 * degraded mode in which something gets published anyway.
 */
export function assertApprovedByNikhil(
  approval: ApprovalRow,
  candidateId: string,
  evidenceRunId: string,
): void {
  if (approval.channel !== 'telegram') {
    throw new Error(
      `Refusing to publish: approval channel is ${JSON.stringify(approval.channel)}. ` +
        `Telegram is the only control surface (DECISIONS D9); the digest email is read-only.`,
    );
  }
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (!allowed) {
    throw new Error(
      'Refusing to publish: TELEGRAM_CHAT_ID is not set, so there is no way to check that ' +
        'this approval came from Nikhil. Set it (finds-coord/lanes/W8-SETUP.md) and re-run. ' +
        'This is a hard stop, not a skip.',
    );
  }
  if (approval.chat_id !== allowed) {
    throw new Error(
      `Refusing to publish: the approval came from chat ${approval.chat_id}, which is not the ` +
        `allowlisted chat. Only Nikhil publishes to Nikhil's site.`,
    );
  }
  if (approval.candidate_id !== candidateId) {
    throw new Error(
      `Refusing to publish: the approval is for candidate ${approval.candidate_id}, not ` +
        `${candidateId}. Approval is per-find and is never transferable.`,
    );
  }
  if (approval.evidence_run_id !== evidenceRunId) {
    throw new Error(
      `Refusing to publish: he approved crawl generation ${approval.evidence_run_id} and this ` +
        `publish is built from ${evidenceRunId}. He approves a find on the strength of the ` +
        `evidence the digest showed him; a re-crawl since then is something he has to see.`,
    );
  }
  if (approval.answer.trim() === '') {
    throw new Error('Refusing to publish: the approval carries no answer. Silence is not consent.');
  }
}
