// Env + policy configuration for the Telegram HITL bridge. All Bot API
// tunables live here, not scattered through telegramClient.ts / ask.ts /
// poll.ts (same convention as finds/gate/config.ts).

export interface TelegramEnvConfig {
  botToken: string;
  chatId: string;
}

/**
 * Reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID and throws a specific, loud
 * error naming exactly what's missing if either is absent. Never returns a
 * partial/fake config -- this is the D6 hard rule (finds-coord/DECISIONS.md):
 * with no token, callers must fail loudly, not pretend to have sent
 * something. The render/dry-run path in ask.ts deliberately does NOT call
 * this, since a render must work with nothing configured.
 */
export function requireTelegramEnv(): TelegramEnvConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const missing = [!botToken && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(
    (v): v is string => Boolean(v),
  );
  if (missing.length > 0) {
    throw new Error(
      `Telegram HITL is not configured: missing ${missing.join(', ')}. See ` +
        `finds-coord/lanes/W8-SETUP.md to provision them. Refusing to fake a ` +
        `send -- this is a hard rule (finds-coord/DECISIONS.md D1/D6).`,
    );
  }
  return { botToken: botToken as string, chatId: chatId as string };
}

export const TELEGRAM_LIMITS = {
  /** sendMessage text hard cap (Bot API). */
  maxMessageLength: 4096,
  /** callback_data hard cap, in bytes (Bot API). */
  maxCallbackDataBytes: 64,
} as const;

export const HITL_CONFIG = {
  /** getUpdates long-poll window, seconds. Telegram caps this at 50. */
  pollTimeoutSec: Number(process.env.TELEGRAM_POLL_TIMEOUT_SEC ?? 30),
  /** Where offset + pending-question state persist between runs. File-backed
   *  for now -- see finds-coord/lanes/W8.md for the known gap this leaves on
   *  ephemeral GitHub Actions runners and the proposed durable-store
   *  follow-up. */
  offsetPath: process.env.TELEGRAM_OFFSET_PATH ?? 'finds/hitl/.state/offset.json',
  pendingPath: process.env.TELEGRAM_PENDING_PATH ?? 'finds/hitl/.state/pending.json',
  /** Consecutive 409s (another poller already holds this bot's getUpdates)
   *  before giving up loudly instead of conflict-looping forever. */
  maxConsecutiveConflicts: 5,
  conflictBackoffMs: 5000,
} as const;
