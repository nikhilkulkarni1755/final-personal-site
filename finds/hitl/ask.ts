// OUT direction: ask Nikhil something on Telegram.
//
// CLI:
//   node finds/hitl/ask.ts --render   '<question JSON>'   # never touches the network
//   node finds/hitl/ask.ts --send     '<question JSON>'   # requires live env (D6)
//   node finds/hitl/ask.ts --render-approval '<approval JSON>'
//   node finds/hitl/ask.ts --send-approval   '<approval JSON>'
// question JSON:  { "prompt": "...", "context": "...", "options": [{"label":"..."}] }
// approval JSON:  { "candidateId": "...", "candidateName": "...",
//                    "evidenceRunId": "...", "context": "..." }

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HITL_CONFIG, TELEGRAM_LIMITS, requireTelegramEnv } from './config.ts';
import { sendMessage, type TelegramInlineButton } from './telegramClient.ts';
import { PendingStore } from './pendingStore.ts';
import type { ApprovalContext, HitlQuestion, PendingQuestion } from './types.ts';

interface BuiltMessage {
  text: string;
  inlineKeyboard?: TelegramInlineButton[][];
}

/**
 * Pure builder: question -> exact Bot API payload shape. Shared by the real
 * send and the render/dry-run path below so a render can never drift from
 * what would actually be sent. `footer` overrides the trailing instruction
 * line -- askApproval() uses this to spell out that a text reply approves
 * too (see there for why that has to be explicit).
 */
export function buildMessage(questionId: string, question: HitlQuestion, footer?: string): BuiltMessage {
  const parts = [question.prompt];
  if (question.context) parts.push('', question.context);
  parts.push(
    '',
    footer ??
      (question.options && question.options.length > 0
        ? 'Reply to this message to answer in your own words, or tap a button below.'
        : 'Reply to this message with your answer.'),
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
export function renderQuestion(question: HitlQuestion, footer?: string): RenderedQuestion {
  const questionId = randomUUID();
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '<unset: TELEGRAM_CHAT_ID>';
  return { questionId, chatId, payload: buildMessage(questionId, question, footer) };
}

/**
 * Sends `question`, records it in the pending store (so poll.ts can match
 * the answer back), and returns the question id. Shared by askQuestion()
 * and askApproval() so the two never drift from a single send-and-track
 * path. Throws loudly if TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are absent --
 * never sends and never claims success without them (D6).
 */
async function sendAndTrack(
  question: HitlQuestion,
  footer: string | undefined,
  approval: ApprovalContext | undefined,
  pendingStorePath: string,
): Promise<string> {
  const { botToken, chatId } = requireTelegramEnv();
  const questionId = randomUUID();
  const payload = buildMessage(questionId, question, footer);

  const sent = await sendMessage(botToken, { chatId, text: payload.text, inlineKeyboard: payload.inlineKeyboard });

  const pending: PendingQuestion = {
    questionId,
    chatId,
    sentMessageId: sent.message_id,
    question,
    createdAt: new Date().toISOString(),
    approval,
  };
  await new PendingStore(pendingStorePath).add(pending);
  return questionId;
}

/**
 * Live send of a plain question. Returns the question id so a caller can
 * later correlate an answer to it.
 */
export async function askQuestion(
  question: HitlQuestion,
  pendingStorePath: string = HITL_CONFIG.pendingPath,
): Promise<string> {
  return sendAndTrack(question, undefined, undefined, pendingStorePath);
}

const APPROVE_LABEL = 'Approve';
const REJECT_LABEL = 'Reject';
/**
 * D32: only the button tap approves -- a reply, alone, never does. Publishing
 * is the one irreversible, outward-facing action in this system, and reading
 * ambiguous free text as consent would make it the one decision this bridge
 * makes EASIER to reach by accident, working against every other lane's
 * posture (D29's missing view, W10's refusal to run finds/comment/**, W11's
 * re-check of chat_id even on a trusted write). So the footer says this
 * outright rather than leaving it to be inferred: a reply is saved as the
 * write-up for the page, but nothing publishes until Approve is tapped.
 */
const APPROVAL_FOOTER =
  'Tap Approve or Reject to decide. Replying with text first just saves it as the write-up for ' +
  'the page (you can still send it any time before tapping) -- only the tap publishes anything.';

export interface AskApprovalParams {
  candidateId: string;
  /** Shown in the prompt. Not stored -- the approval row only ever carries candidateId. */
  candidateName: string;
  evidenceRunId: string;
  /**
   * Extra context above the buttons -- e.g. a one-line reason this
   * qualified. W8 doesn't own scoring or evidence (finds/score/**,
   * finds/verify/**), so building that summary is the caller's job.
   */
  context?: string;
}

function buildApprovalQuestion(params: AskApprovalParams): HitlQuestion {
  return {
    prompt: `Publish "${params.candidateName}"?`,
    context: params.context,
    options: [{ label: APPROVE_LABEL }, { label: REJECT_LABEL }],
  };
}

/** Dry-run counterpart to askApproval(). Never touches the network. */
export function renderApproval(params: AskApprovalParams): RenderedQuestion {
  return renderQuestion(buildApprovalQuestion(params), APPROVAL_FOOTER);
}

/**
 * Live send of an approval ask. The pending entry it creates carries
 * candidateId/evidenceRunId so poll.ts's answer routing can write the
 * finds_approvals row (approvals.ts) -- but only when Nikhil taps Approve
 * (approveOptionIndex 0; Reject writes nothing). A free-text reply is never
 * enough on its own (D32): poll.ts saves it as a draft why_interesting and
 * keeps the question pending until a tap actually approves it.
 */
export async function askApproval(
  params: AskApprovalParams,
  pendingStorePath: string = HITL_CONFIG.pendingPath,
): Promise<string> {
  const approval: ApprovalContext = {
    candidateId: params.candidateId,
    evidenceRunId: params.evidenceRunId,
    approveOptionIndex: 0,
  };
  return sendAndTrack(buildApprovalQuestion(params), APPROVAL_FOOTER, approval, pendingStorePath);
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

const MODES = ['--render', '--send', '--render-approval', '--send-approval'] as const;
type Mode = (typeof MODES)[number];

async function main(): Promise<void> {
  const [mode, json] = process.argv.slice(2);
  if (!MODES.includes(mode as Mode)) {
    console.error(
      'usage:\n' +
        '  node finds/hitl/ask.ts --render|--send \'{"prompt":"...","context":"...","options":[{"label":"..."}]}\'\n' +
        '  node finds/hitl/ask.ts --render-approval|--send-approval \'{"candidateId":"...","candidateName":"...","evidenceRunId":"...","context":"..."}\'',
    );
    process.exit(1);
  }
  if (!json) {
    console.error('missing JSON argument');
    process.exit(1);
  }

  if (mode === '--render') {
    printRender(renderQuestion(JSON.parse(json) as HitlQuestion));
    return;
  }
  if (mode === '--send') {
    const questionId = await askQuestion(JSON.parse(json) as HitlQuestion);
    console.log(`sent. question_id=${questionId}`);
    return;
  }
  if (mode === '--render-approval') {
    printRender(renderApproval(JSON.parse(json) as AskApprovalParams));
    return;
  }
  const questionId = await askApproval(JSON.parse(json) as AskApprovalParams);
  console.log(`sent. question_id=${questionId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
