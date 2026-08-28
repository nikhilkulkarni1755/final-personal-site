// IN direction: poll getUpdates, drop anything not from our own chat,
// and match replies/button taps back to whatever question is waiting.
//
// Offset handling: every update we look at -- matched to a pending question
// or not -- advances the persisted offset, because passing offset=N to
// getUpdates tells Telegram it may forget every update up to N-1
// regardless of what we did with it. Skipping that for "uninteresting"
// updates would make us re-fetch (and re-decide to ignore) them forever.
//
// 409 handling: Telegram allows only one getUpdates long-poll per bot at a
// time. If a second poller starts, both flap; we back off and retry a
// bounded number of times rather than crash-looping or silently stalling.
//
// Security: chat id filtering happens BEFORE anything else touches an
// update's content -- a message/callback from any other chat is dropped
// without being routed, logged with its content, or acknowledged.

import { pathToFileURL } from 'node:url';
import { HITL_CONFIG, requireTelegramEnv } from './config.ts';
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  getUpdates,
  TelegramConflictError,
  type TelegramUpdate,
} from './telegramClient.ts';
import { writeApproval } from './approvals.ts';
import { FileOffsetStore } from './offsetStore.ts';
import { PendingStore } from './pendingStore.ts';
import type { ApprovalWriteStatus, HitlAnswer, PendingQuestion } from './types.ts';

const CALLBACK_DATA_RE = /^q:([^:]+):(\d+)$/;

function isOurChat(chatId: number, expected: string): boolean {
  return String(chatId) === expected;
}

/**
 * Best-effort: a UI confirmation must never be allowed to abort answer
 * routing, and it must not blow up a retry either. If a mid-batch failure
 * (see pollOnce) causes the SAME update to be reprocessed on the next poll,
 * this callback_query_id may already have been answered once -- Telegram
 * rejects a second answerCallbackQuery on it, and that rejection is exactly
 * as harmless as it sounds, so it is swallowed here rather than in every
 * call site.
 */
async function safeAnswerCallback(botToken: string, callbackQueryId: string, text?: string): Promise<void> {
  try {
    await answerCallbackQuery(botToken, callbackQueryId, text);
  } catch {
    /* non-fatal, see above */
  }
}

/**
 * Writes the finds_approvals row for a matched approval answer, if the
 * option tapped was the approve one. Deliberately called BEFORE
 * pending.remove() at both call sites below: writeApproval() can throw (a
 * real DB failure, or the FK refusing an unscored generation) and when it
 * does, the pending entry must still be there and the offset must not have
 * advanced, so the next poll retries this exact answer rather than losing
 * it. See DEPENDENCIES.md's finds_approvals entry (D29) for the table
 * contract this writes to.
 */
async function routeApproval(
  entry: PendingQuestion,
  chatId: string,
  messageId: number,
  updateId: number,
  answer: string,
  whyInteresting: string | undefined,
): Promise<ApprovalWriteStatus> {
  const approval = entry.approval;
  if (!approval) throw new Error('routeApproval called on a non-approval pending entry');
  const result = await writeApproval({
    candidate_id: approval.candidateId,
    evidence_run_id: approval.evidenceRunId,
    chat_id: chatId,
    message_id: messageId,
    telegram_update_id: updateId,
    answer,
    why_interesting: whyInteresting,
    answered_at: new Date().toISOString(),
  });
  return result.status;
}

async function handleUpdate(
  update: TelegramUpdate,
  botToken: string,
  chatId: string,
  pending: PendingStore,
): Promise<HitlAnswer | undefined> {
  const cq = update.callback_query;
  if (cq) {
    const message = cq.message;
    if (!message || !isOurChat(message.chat.id, chatId)) {
      // Not our chat: drop entirely. Do not even answerCallbackQuery --
      // that would confirm to a stranger that this bot is alive.
      return undefined;
    }
    const match = CALLBACK_DATA_RE.exec(cq.data ?? '');
    if (!match) {
      await safeAnswerCallback(botToken, cq.id);
      return undefined;
    }
    const [, questionId, idxStr] = match;
    const entry = await pending.findByQuestionId(questionId);
    if (!entry) {
      await safeAnswerCallback(botToken, cq.id, 'This question is no longer open.');
      return undefined;
    }
    const idx = Number(idxStr);
    const option = entry.question.options?.[idx];
    if (!option) {
      await safeAnswerCallback(botToken, cq.id);
      return undefined;
    }

    let approvalStatus: ApprovalWriteStatus | undefined;
    let confirmation = `Recorded: ${option.label}`;
    if (entry.approval) {
      if (idx === entry.approval.approveOptionIndex) {
        // message.message_id: a button tap creates no new Telegram message,
        // so the original (bot-sent) message is the only message this
        // answer can be keyed to -- see approvals.ts / DEPENDENCIES.md.
        approvalStatus = await routeApproval(
          entry,
          chatId,
          message.message_id,
          update.update_id,
          option.label,
          undefined, // a tapped option label is not prose he wrote (D4)
        );
        confirmation = approvalStatus === 'inserted' ? `Approved: ${option.label}` : `Already recorded (${approvalStatus}).`;
      } else {
        // Reject: nothing is ever written to finds_approvals for this (D29).
        approvalStatus = 'rejected';
        confirmation = 'Noted -- not publishing.';
      }
    }

    await pending.remove(questionId);
    await safeAnswerCallback(botToken, cq.id, confirmation);
    try {
      // Best-effort: strip the keyboard so a second tap can't double-answer.
      // Non-fatal if the message was already edited/deleted meanwhile.
      await editMessageReplyMarkup(botToken, chatId, entry.sentMessageId, undefined);
    } catch {
      /* non-fatal */
    }
    return { questionId, kind: 'option', value: option.label, respondedAt: new Date().toISOString(), approvalStatus };
  }

  const msg = update.message;
  if (msg) {
    if (!isOurChat(msg.chat.id, chatId)) return undefined; // drop, unprocessed
    const replyToId = msg.reply_to_message?.message_id;
    if (replyToId === undefined || msg.text === undefined) return undefined;
    const entry = await pending.findBySentMessageId(replyToId);
    if (!entry) return undefined;

    // msg.text, unmodified everywhere below: no .trim(), no markdown/entity
    // handling, no re-encoding. This is the D4 byte-for-byte fidelity
    // requirement -- checked in finds/hitl/verifyFidelity.ts -- and it now
    // also governs what a published page renders as Nikhil's own words
    // (why_interesting), so it matters even more than it did before D29.
    let approvalStatus: ApprovalWriteStatus | undefined;
    if (entry.approval) {
      // A free-text reply to an approval question approves it, using this
      // same text as both the receipt (`answer`) and the prose he wrote for
      // the page (`why_interesting`) -- see APPROVAL_FOOTER in ask.ts for
      // why that has to be spelled out to him up front, not inferred here.
      approvalStatus = await routeApproval(entry, chatId, msg.message_id, update.update_id, msg.text, msg.text);
    }

    await pending.remove(entry.questionId);
    return {
      questionId: entry.questionId,
      kind: 'text',
      value: msg.text,
      respondedAt: new Date().toISOString(),
      approvalStatus,
    };
  }

  return undefined;
}

/**
 * One getUpdates round trip: fetch, process, advance + persist the offset,
 * return whatever answers were matched. Safe to call once per cron
 * invocation, or repeatedly from runPoller() below.
 */
export async function pollOnce(): Promise<HitlAnswer[]> {
  const { botToken, chatId } = requireTelegramEnv();
  const offsetStore = new FileOffsetStore(HITL_CONFIG.offsetPath);
  const pending = new PendingStore(HITL_CONFIG.pendingPath);

  const offset = await offsetStore.read();
  const updates = await getUpdates(botToken, offset, HITL_CONFIG.pollTimeoutSec);

  const answers: HitlAnswer[] = [];
  let maxUpdateId: number | undefined;
  for (const update of updates) {
    const answer = await handleUpdate(update, botToken, chatId, pending);
    if (answer) answers.push(answer);
    maxUpdateId = maxUpdateId === undefined ? update.update_id : Math.max(maxUpdateId, update.update_id);
  }

  if (maxUpdateId !== undefined) {
    await offsetStore.write(maxUpdateId + 1);
  }
  return answers;
}

/**
 * Long-running loop: pollOnce() back to back, forever. Each call already
 * blocks on Telegram's long-poll, so this is not a busy loop.
 */
export async function runPoller(): Promise<never> {
  let consecutiveConflicts = 0;
  for (;;) {
    try {
      const answers = await pollOnce();
      consecutiveConflicts = 0;
      for (const answer of answers) console.log(JSON.stringify(answer));
    } catch (err) {
      if (err instanceof TelegramConflictError) {
        consecutiveConflicts += 1;
        console.error(
          `getUpdates conflict (${consecutiveConflicts}/${HITL_CONFIG.maxConsecutiveConflicts}): another poller is running against this bot.`,
        );
        if (consecutiveConflicts >= HITL_CONFIG.maxConsecutiveConflicts) {
          throw new Error(
            'Too many consecutive getUpdates conflicts -- a second poller appears to be running against this bot. Exiting rather than fighting it forever.',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, HITL_CONFIG.conflictBackoffMs));
        continue;
      }
      throw err;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPoller().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
