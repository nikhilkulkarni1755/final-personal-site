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
 * WHAT IS STILL MISSING, and this lane does not paper over it: W8's offset and
 * pending state are file-backed, so an approval given in Telegram does not
 * survive an ephemeral GitHub Actions runner (W8 says so itself; W10
 * deliberately left Telegram out of the daily run for that reason). Until an
 * approval is durable, there is no unattended path from "Nikhil said yes" to a
 * published row, and this module will not invent one. The proposed durable
 * design is written up in finds-coord/lanes/W11.md for the coordinator.
 */

/** Telegram only. D9: the digest email is read-only and cannot approve. */
export type ApprovalChannel = 'telegram';

export interface FindApproval {
  /** Exactly which find. An approval is never transferable to another. */
  candidate_id: string;
  channel: ApprovalChannel;
  /** The chat the answer came from. Must be Nikhil's allowlisted chat. */
  chat_id: string;
  /** Bot API message id of his answer -- the receipt, so an approval is traceable. */
  message_id: number;
  answered_at: string;
  /**
   * Exactly what he sent, an inline-keyboard label or free text. Stored as the
   * receipt; never rewritten, never parsed for intent beyond being non-empty.
   */
  answer: string;
  /**
   * Prose he wrote for the page, verbatim, or absent. Per D4 the system never
   * authors words in his name, so this is carried separately from `answer`: an
   * option label he tapped is not something he wrote about the product, and
   * must never end up rendered as his opinion.
   */
  why_interesting?: string;
}

/**
 * Throws unless this approval is Nikhil's, for this find. Every failure is a
 * hard stop with a specific message -- per D6 there is no degraded mode in
 * which something gets published anyway.
 */
export function assertApprovedByNikhil(approval: FindApproval, candidateId: string): void {
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
  if (approval.answer.trim() === '') {
    throw new Error('Refusing to publish: the approval carries no answer. Silence is not consent.');
  }
}
