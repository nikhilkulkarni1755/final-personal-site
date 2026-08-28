// HITL-internal types. Candidates for finds/types.ts once another lane
// needs them -- propose additions through the coordinator rather than
// writing there directly (W3 owns that file; see finds-coord/DEPENDENCIES.md,
// FILE OWNERSHIP).

export interface HitlOption {
  /** Shown as an inline-keyboard button label. */
  label: string;
}

export interface HitlQuestion {
  /** Shown at the top of the Telegram message. */
  prompt: string;
  /** Extra context so Nikhil can answer without opening a laptop. */
  context?: string;
  /** Inline-keyboard choices. Omit for a free-text-only question. */
  options?: HitlOption[];
}

export type HitlAnswerKind = 'option' | 'text';

/**
 * Set on a matched answer only when the question it answers was an
 * askApproval() (see ask.ts) -- i.e. the routing in poll.ts attempted (or
 * deliberately skipped) a finds_approvals write for it (D29).
 *   'inserted'          -- a new row was written. Only an explicit
 *                          inline-keyboard Approve tap ever causes this
 *                          (D32): free text alone never does.
 *   'duplicate_message' -- this exact (chat_id, message_id) was already
 *                          recorded; Telegram redelivered an update we'd
 *                          already handled. Not an error.
 *   'already_approved'  -- a DIFFERENT message already approved this same
 *                          (candidate_id, evidence_run_id). Not an error.
 *   'rejected'           -- Nikhil tapped the non-approve option. Nothing is
 *                          ever written for a rejection (DECISIONS D29 has
 *                          no reject representation in finds_approvals).
 *   'noted'              -- a free-text reply arrived before any tap. Saved
 *                          as a draft why_interesting on the pending entry
 *                          (see ApprovalContext.draftNote) but NOT written
 *                          to finds_approvals: D32 holds that ambiguity is
 *                          not consent, so only a tap approves.
 */
export type ApprovalWriteStatus = 'inserted' | 'duplicate_message' | 'already_approved' | 'rejected' | 'noted';

export interface HitlAnswer {
  questionId: string;
  kind: HitlAnswerKind;
  /**
   * For kind 'option': the matched option's label.
   * For kind 'text': Nikhil's reply exactly as Telegram delivered it --
   * never trimmed, never markdown-normalised, never re-encoded (D4).
   */
  value: string;
  respondedAt: string;
  /** Present only when this answered an askApproval() question. */
  approvalStatus?: ApprovalWriteStatus;
}

/**
 * Carried on a PendingQuestion when it was sent by askApproval() rather than
 * askQuestion(), so poll.ts knows which find/generation a matched answer
 * approves and which option index means "approve" (the other -- there are
 * always exactly two -- means reject, and a reject writes nothing: D29
 * deliberately has no reject representation in finds_approvals).
 *
 * D32: only the inline-keyboard tap approves. A free-text reply arriving
 * first is captured here as `draftNote` rather than written to
 * finds_approvals -- ambiguity is not consent. If a later tap approves, the
 * write uses `draftNote` as why_interesting; if he never taps, nothing is
 * ever written and the note is discarded with the rest of the pending entry.
 */
export interface ApprovalContext {
  candidateId: string;
  evidenceRunId: string;
  approveOptionIndex: number;
  /** Free text he sent before tapping, verbatim. See D32 above. */
  draftNote?: string;
}

/** A question that has been sent and is awaiting Nikhil's answer. */
export interface PendingQuestion {
  questionId: string;
  chatId: string;
  sentMessageId: number;
  question: HitlQuestion;
  createdAt: string;
  /** Present only for an approval question (askApproval()). */
  approval?: ApprovalContext;
}
