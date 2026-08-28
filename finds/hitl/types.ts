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
}

/** A question that has been sent and is awaiting Nikhil's answer. */
export interface PendingQuestion {
  questionId: string;
  chatId: string;
  sentMessageId: number;
  question: HitlQuestion;
  createdAt: string;
}
