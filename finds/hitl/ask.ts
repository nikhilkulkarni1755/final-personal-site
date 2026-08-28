// OUT direction: ask Nikhil something on Telegram.
//
// CLI:
//   node finds/hitl/ask.ts --render '<question JSON>'   # never touches the network
//   node finds/hitl/ask.ts --send   '<question JSON>'   # requires live env (D6)
// question JSON: { "prompt": "...", "context": "...", "options": [{"label":"..."}] }

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HITL_CONFIG, TELEGRAM_LIMITS, requireTelegramEnv } from './config.ts';
import { sendMessage, type TelegramInlineButton } from './telegramClient.ts';
import { PendingStore } from './pendingStore.ts';
import type { HitlQuestion, PendingQuestion } from './types.ts';

interface BuiltMessage {
  text: string;
  inlineKeyboard?: TelegramInlineButton[][];
}

/**
 * Pure builder: question -> exact Bot API payload shape. Shared by the real
 * send and the render/dry-run path below so a render can never drift from
 * what would actually be sent.
 */
export function buildMessage(questionId: string, question: HitlQuestion): BuiltMessage {
  const parts = [question.prompt];
  if (question.context) parts.push('', question.context);
  parts.push(
    '',
    question.options && question.options.length > 0
      ? 'Reply to this message to answer in your own words, or tap a button below.'
      : 'Reply to this message with your answer.',
  );
  const text = parts.join('\n');

  if (text.length > TELEGRAM_LIMITS.maxMessageLength) {
    throw new Error(
      `HITL question is ${text.length} chars, over Telegram's ${TELEGRAM_LIMITS.maxMessageLength}-char sendMessage limit -- shorten prompt/context.`,
    );
  }

  let inlineKeyboard: TelegramInlineButton[][] | undefined;
  if (question.options && question.options.length > 0) {
    inlineKeyboard = question.options.map((opt, idx) => {
      const callbackData = `q:${questionId}:${idx}`;
      if (Buffer.byteLength(callbackData, 'utf8') > TELEGRAM_LIMITS.maxCallbackDataBytes) {
        throw new Error(
          `callback_data for option ${idx} exceeds Telegram's ${TELEGRAM_LIMITS.maxCallbackDataBytes}-byte limit`,
        );
      }
      return [{ text: opt.label, callback_data: callbackData }];
    });
  }
  return { text, inlineKeyboard };
}

export interface RenderedQuestion {
  questionId: string;
  chatId: string;
  payload: BuiltMessage;
}

/**
 * Dry-run: builds the exact payload without touching the network or
 * requiring any env var. Clearly a render, never to be confused with a
 * send (D6) -- callers must not report this as "sent".
 */
export function renderQuestion(question: HitlQuestion): RenderedQuestion {
  const questionId = randomUUID();
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '<unset: TELEGRAM_CHAT_ID>';
  return { questionId, chatId, payload: buildMessage(questionId, question) };
}

/**
 * Live send. Throws loudly if TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are absent
 * -- never sends and never claims success without them (D6). Returns the
 * question id so a caller can later correlate an answer to it.
 */
export async function askQuestion(
  question: HitlQuestion,
  pendingStorePath: string = HITL_CONFIG.pendingPath,
): Promise<string> {
  const { botToken, chatId } = requireTelegramEnv();
  const questionId = randomUUID();
  const payload = buildMessage(questionId, question);

  const sent = await sendMessage(botToken, { chatId, text: payload.text, inlineKeyboard: payload.inlineKeyboard });

  const pending: PendingQuestion = {
    questionId,
    chatId,
    sentMessageId: sent.message_id,
    question,
    createdAt: new Date().toISOString(),
  };
  await new PendingStore(pendingStorePath).add(pending);
  return questionId;
}

function printRender(rendered: RenderedQuestion): void {
  console.log('=== RENDER (not sent) ===');
  console.log(`chat_id:     ${rendered.chatId}`);
  console.log(`question_id: ${rendered.questionId}`);
  console.log('--- message text ---');
  console.log(rendered.payload.text);
  if (rendered.payload.inlineKeyboard) {
    console.log('--- inline keyboard ---');
    console.log(JSON.stringify(rendered.payload.inlineKeyboard, null, 2));
  }
}

async function main(): Promise<void> {
  const [mode, questionJson] = process.argv.slice(2);
  if (mode !== '--render' && mode !== '--send') {
    console.error(
      "usage: node finds/hitl/ask.ts --render|--send '{\"prompt\":\"...\",\"context\":\"...\",\"options\":[{\"label\":\"...\"}]}'",
    );
    process.exit(1);
  }
  if (!questionJson) {
    console.error('missing question JSON argument');
    process.exit(1);
  }
  const question = JSON.parse(questionJson) as HitlQuestion;

  if (mode === '--render') {
    printRender(renderQuestion(question));
    return;
  }

  const questionId = await askQuestion(question);
  console.log(`sent. question_id=${questionId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
