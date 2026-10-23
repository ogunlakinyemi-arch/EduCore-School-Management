// Only fixed, allowlisted copy reaches notification diagnostics.
export const notificationErrorClass = 'rounded-lg bg-[#fff1f2] p-3 text-sm text-[#991b1b] break-words';
export const telegramReasons: Record<string, string> = {
  DEVELOPMENT_ONLY: 'Telegram is currently Development-only. The published application cannot run this check; an Owner must review Production support separately.',
  TOKEN_MISSING: 'The bot token is not configured. Ask the Owner to configure the Telegram bot credential securely.',
  ENCRYPTION_KEY_UNAVAILABLE: 'Telegram link encryption is unavailable. Ask the Owner to review the server session encryption configuration.',
  INVALID_TOKEN: 'Telegram rejected the bot credential. Ask the Owner to verify the configured bot token securely.',
  RATE_LIMITED: 'Telegram rate-limited the check. Wait at least a minute before trying again.',
  PROVIDER_FORBIDDEN: 'Telegram refused access to this bot. Ask the Owner to review bot access with Telegram.',
  PROVIDER_UNAVAILABLE: 'Telegram is temporarily unavailable. Try again later.',
  NETWORK_UNAVAILABLE: 'The server could not reach Telegram. Ask the Owner to check outbound HTTPS connectivity.',
  TIMEOUT: 'Telegram did not respond in time. Try again later; ask the Owner to check outbound connectivity if it persists.',
  INVALID_RESPONSE: 'Telegram returned an unexpected response. Ask the Owner to review the sanitized bot-check logs.',
  BOT_UNAVAILABLE: 'The bot could not be verified. Ask the Owner to review the sanitized bot-check logs.',
  WEBHOOK_CONFLICT: 'This bot has an existing webhook. Ask the Owner to review the intended integration; this check does not change it.',
  SCHEMA_NOT_READY: 'Telegram storage is not ready. Ask the Owner to review the required schema; this check does not apply migrations.',
  CHECK_STORAGE_UNAVAILABLE: 'The server could not inspect Telegram storage. Ask the Owner to check database availability and the sanitized logs.',
  CHECK_AUDIT_UNAVAILABLE: 'The check could not record its audit entry. Ask the Owner to check audit storage before retrying.',
  DEVELOPMENT_SEND_LOCK: 'Bot credentials passed, but Development sending remains locked. This check does not change send permissions.',
  HEALTH_CHECK_REQUIRED: 'Run the bot configuration check to verify the current credential.',
};
export function telegramCheckError(error: unknown) {
  const e = error as { status?: number; data?: { reason?: string } } | null;
  const reason = e?.data?.reason;
  if (reason && Object.hasOwn(telegramReasons, reason)) return telegramReasons[reason];
  return e?.status === 404 ? telegramReasons.DEVELOPMENT_ONLY
    : e?.status === 401 ? 'Your session has expired. Sign in again before checking the bot.'
    : e?.status === 403 ? 'Only an authorized Platform Owner can run this check. Refresh your session and try again.'
    : e?.status === 429 ? 'Wait ten seconds before running another bot check.'
    : 'The server could not complete the bot check. Retry later; ask the Owner to review sanitized bot-check logs if it persists.';
}
