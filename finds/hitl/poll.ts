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
import { FileOffsetStore } from './offsetStore.ts';
import { PendingStore } from './pendingStore.ts';
import type { HitlAnswer } from './types.ts';

const CALLBACK_DATA_RE = /^q:([^:]+):(\d+)$/;

function isOurChat(chatId: number, expected: string): boolean {
  return String(chatId) === expected;
}

async function handleUpdate(
  update: TelegramUpdate,
  botToken: string,
  chatId: string,
  pending: PendingStore,
): Promise<HitlAnswer | undefined> {
  const cq = update.callback_query;
  if (cq) {
    const fromChat = cq.message?.chat.id;
    if (fromChat === undefined || !isOurChat(fromChat, chatId)) {
      // Not our chat: drop entirely. Do not even answerCallbackQuery --
      // that would confirm to a stranger that this bot is alive.
      return undefined;
    }
    const match = CALLBACK_DATA_RE.exec(cq.data ?? '');
    if (!match) {
      await answerCallbackQuery(botToken, cq.id);
      return undefined;
    }
    const [, questionId, idxStr] = match;
    const entry = await pending.findByQuestionId(questionId);
    if (!entry) {
      await answerCallbackQuery(botToken, cq.id, 'This question is no longer open.');
      return undefined;
    }
    const option = entry.question.options?.[Number(idxStr)];
    if (!option) {
      await answerCallbackQuery(botToken, cq.id);
      return undefined;
    }
    await pending.remove(questionId);
    await answerCallbackQuery(botToken, cq.id, `Recorded: ${option.label}`);
    try {
      // Best-effort: strip the keyboard so a second tap can't double-answer.
      // Non-fatal if the message was already edited/deleted meanwhile.
      await editMessageReplyMarkup(botToken, chatId, entry.sentMessageId, undefined);
    } catch {
      /* non-fatal */
    }
    return { questionId, kind: 'option', value: option.label, respondedAt: new Date().toISOString() };
  }

  const msg = update.message;
  if (msg) {
    if (!isOurChat(msg.chat.id, chatId)) return undefined; // drop, unprocessed
    const replyToId = msg.reply_to_message?.message_id;
    if (replyToId === undefined || msg.text === undefined) return undefined;
    const entry = await pending.findBySentMessageId(replyToId);
    if (!entry) return undefined;
    await pending.remove(entry.questionId);
    // msg.text, unmodified: no .trim(), no markdown/entity handling, no
    // re-encoding. This is the D4 byte-for-byte fidelity requirement --
    // checked in finds/hitl/verifyFidelity.ts.
    return { questionId: entry.questionId, kind: 'text', value: msg.text, respondedAt: new Date().toISOString() };
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
