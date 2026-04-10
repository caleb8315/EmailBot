import { createLogger } from "./logger";

const logger = createLogger("user_identity");

/**
 * Resolves the canonical user id used for preference reads/writes.
 * Priority:
 * 1) PREFERENCE_USER_ID (explicit override)
 * 2) TELEGRAM_CHAT_ID (current single-owner default)
 * 3) DEFAULT_USER_ID
 * 4) "default"
 */
export function resolvePreferenceUserId(): string {
  const explicit = process.env.PREFERENCE_USER_ID?.trim();
  if (explicit) return explicit;

  const telegramChat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (telegramChat) return telegramChat;

  const fallback = process.env.DEFAULT_USER_ID?.trim();
  if (fallback) return fallback;

  return "default";
}

export function logResolvedPreferenceUserId(context: string): string {
  const userId = resolvePreferenceUserId();
  logger.info("Resolved preference user id", { context, userId });
  return userId;
}
