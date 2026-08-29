// Env + policy configuration for the Telegram HITL bridge. All Bot API
// tunables live here, not scattered through telegramClient.ts / ask.ts /
// poll.ts (same convention as finds/gate/config.ts).

import { fileURLToPath } from 'node:url';

// Anchored to this file's own location, not process.cwd(): D34 (2026-08-29)
// traced "his taps looked dead" to ask.ts and poll.ts having been run from
// two different working directories, so each wrote/read a different
// finds/hitl/.state/*.json. Anchoring removes cwd as a variable for two
// invocations of the SAME checkout. It does NOT fix two different
// checkouts/worktrees each running their own copy of this file -- that is
// exactly why the pending store is moving into Postgres (see
// finds-coord/lanes/W8.md); this is a cheap stopgap alongside it, not a
// substitute for it.
const STATE_DIR = fileURLToPath(new URL('./.state', import.meta.url));

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
  /** Offset: still file-backed, anchored to this checkout (see STATE_DIR
   *  above). Durability across an ephemeral runner is a separate, not-yet-
   *  hit concern (finds-coord/lanes/W8.md).
   *  Pending questions: file-backed here only until W3 lands the proposed
   *  finds_hitl_pending table (D34) -- once that exists this path stops
   *  being read at all. */
  offsetPath: process.env.TELEGRAM_OFFSET_PATH ?? `${STATE_DIR}/offset.json`,
  pendingPath: process.env.TELEGRAM_PENDING_PATH ?? `${STATE_DIR}/pending.json`,
  /** Consecutive 409s (another poller already holds this bot's getUpdates)
   *  before giving up loudly instead of conflict-looping forever. */
  maxConsecutiveConflicts: 5,
  conflictBackoffMs: 5000,
} as const;
