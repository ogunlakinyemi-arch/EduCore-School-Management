/** Deliberately not fuzzy: case, whitespace and punctuation separators only.
 * LTD is accepted only as the final legal suffix. No missing/reordered words,
 * personal names, extra tokens, transliteration or approximate spelling. */
export const OWNER_RECEIVING_ACCOUNT_POLICY = "YETENIA_BENEFICIARY_LIVE_V1";
export function officialOwnerAccountName(value: unknown): boolean {
  if (typeof value !== "string" || !/^[a-zA-Z\s.,-]+$/.test(value)) return false;
  const tokens = value.toUpperCase().replace(/[.,-]/g, " ").trim().split(/\s+/);
  if (tokens.at(-1) === "LTD") tokens[tokens.length - 1] = "LIMITED";
  return tokens.join(" ") === "YETENIA TECHNOLOGIES LIMITED";
}

export function liveOwnerResolutionConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env.EDUCORE_FLUTTERWAVE_MODE === "LIVE"
    && /^FLWSECK-(?!TEST-)[A-Za-z0-9_-]{8,}$/.test(env.FLUTTERWAVE_LIVE_SECRET_KEY ?? "");
}
