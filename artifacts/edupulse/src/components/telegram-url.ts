const RE = /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{2,31})\?start=([A-Za-z0-9_-]{43})$/;
/** Returns the url only if it is an exact https://t.me/<bot>?start=<43 base64url> link. */
export function validTelegramUrl(url: unknown): string | null {
  return typeof url === 'string' && RE.test(url) ? url : null;
}
