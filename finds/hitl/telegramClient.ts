// Thin wrapper over the Telegram Bot API (https://core.telegram.org/bots/api).
// Plain fetch, no client library: the surface we need is four JSON-over-HTTPS
// methods (sendMessage, getUpdates, answerCallbackQuery,
// editMessageReplyMarkup) and a library would buy us schema types we don't
// trust blindly anyway -- we read the docs and type only the fields we use.
//
// Hard rule: never let the bot token reach a log or an error message. The
// token lives only in the request URL, which we never print; redact() is
// belt-and-suspenders for the rare case a lower-level fetch error embeds it.

const API_ROOT = 'https://api.telegram.org';

function redact(message: string, token: string): string {
  return token ? message.split(token).join('<redacted>') : message;
}

export class TelegramApiError extends Error {
  readonly method: string;
  readonly errorCode: number | undefined;

  constructor(method: string, errorCode: number | undefined, description: string) {
    super(`Telegram ${method} failed (${errorCode ?? '?'}): ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.errorCode = errorCode;
  }
}

/** HTTP 409: another getUpdates long-poll is already running for this bot. */
export class TelegramConflictError extends TelegramApiError {}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

async function callBotApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(redact(`Telegram ${method} request failed: ${(err as Error).message}`, token));
  } finally {
    clearTimeout(timer);
  }

  let body: TelegramApiResponse<T>;
  try {
    body = (await res.json()) as TelegramApiResponse<T>;
  } catch {
    throw new Error(`Telegram ${method} returned a non-JSON response (status ${res.status})`);
  }

  if (!body.ok) {
    const description = body.description ?? 'unknown error';
    if (res.status === 409) throw new TelegramConflictError(method, body.error_code, description);
    throw new TelegramApiError(method, body.error_code, description);
  }
  return body.result as T;
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  reply_to_message?: { message_id: number };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface SendMessageParams {
  chatId: string;
  text: string;
  inlineKeyboard?: TelegramInlineButton[][];
  /** Threads this message under an earlier one (current Bot API: reply_parameters). */
  replyToMessageId?: number;
}

export async function sendMessage(
  token: string,
  params: SendMessageParams,
  timeoutMs = 10_000,
): Promise<TelegramMessage> {
  // Deliberately no parse_mode. Telegram then applies no Markdown/HTML entity
  // parsing to `text` at all, on the way out. That keeps sends immune to
  // parse errors on characters we didn't anticipate, and -- more to the
  // point of D4 -- means this module never has a code path that reformats
  // text, so there is nothing here that could later leak into the reply
  // path by copy-paste.
  return callBotApi<TelegramMessage>(
    token,
    'sendMessage',
    {
      chat_id: params.chatId,
      text: params.text,
      reply_markup: params.inlineKeyboard ? { inline_keyboard: params.inlineKeyboard } : undefined,
      reply_parameters: params.replyToMessageId ? { message_id: params.replyToMessageId } : undefined,
    },
    timeoutMs,
  );
}

export async function getUpdates(
  token: string,
  offset: number | undefined,
  timeoutSec: number,
): Promise<TelegramUpdate[]> {
  // Our own request timeout must exceed Telegram's long-poll window, or we
  // abort a request Telegram was still about to answer.
  const timeoutMs = timeoutSec * 1000 + 10_000;
  return callBotApi<TelegramUpdate[]>(
    token,
    'getUpdates',
    { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
    timeoutMs,
  );
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callBotApi<true>(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text }, 10_000);
}

/** Pass `undefined` keyboard to strip the buttons entirely. */
export async function editMessageReplyMarkup(
  token: string,
  chatId: string,
  messageId: number,
  inlineKeyboard: TelegramInlineButton[][] | undefined,
): Promise<void> {
  await callBotApi<TelegramMessage | true>(
    token,
    'editMessageReplyMarkup',
    {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : undefined,
    },
    10_000,
  );
}
