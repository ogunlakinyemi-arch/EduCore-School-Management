/** Prospective policy only. Never reinterpret SCV1/2/3 transactions. */
export const HOSTED_POLICY = {
  code: "HOSTED_MANUAL_V1", grossMinor: 500_000, schoolMinor: 190_000,
  broMinor: 10_000, platformWithBroMinor: 300_000, platformWithoutBroMinor: 310_000,
} as const;
export type HostedMode = "TEST" | "LIVE";
export class HostedPaymentError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export function hostedConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.EDUCORE_HOSTED_PAYMENTS_ENABLED === "true";
  const mode: HostedMode = env.EDUCORE_HOSTED_PAYMENTS_MODE === "LIVE" ? "LIVE" : "TEST";
  const secret = mode === "LIVE" ? env.FLUTTERWAVE_LIVE_SECRET_KEY : env.FLUTTERWAVE_SECRET_Test_Key;
  // No generic credential fallback: TEST and LIVE must never share credentials.
  const webhookHash = mode === "LIVE"
    ? env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH : env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH;
  const blockers: string[] = [];
  if (!enabled) blockers.push("Hosted payments have not been enabled.");
  if (!["TEST", "LIVE"].includes(env.EDUCORE_HOSTED_PAYMENTS_MODE ?? "")) blockers.push("Select an explicit TEST or LIVE mode.");
  if (!secret) blockers.push(`Dedicated ${mode} secret ${mode === "LIVE" ? "FLUTTERWAVE_LIVE_SECRET_KEY" : "FLUTTERWAVE_SECRET_Test_Key"} is required.`);
  if (!webhookHash) blockers.push(`Dedicated ${mode} webhook verification hash ${mode === "LIVE" ? "FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH" : "FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH"} is required.`);
  const otherSecret = mode === "LIVE" ? env.FLUTTERWAVE_SECRET_Test_Key : env.FLUTTERWAVE_LIVE_SECRET_KEY;
  const otherHash = mode === "LIVE" ? env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH : env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH;
  if ((secret && secret === otherSecret) || (webhookHash && webhookHash === otherHash)) {
    blockers.push("TEST and LIVE credentials must be distinct.");
  }
  let publicBase = "";
  try {
    const u = new URL(env.EDUCORE_HOSTED_PAYMENTS_PUBLIC_URL ?? "");
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw new Error();
    publicBase = u.href.replace(/\/$/, "");
  } catch { blockers.push("Configure the approved HTTPS app base URL."); }
  if (mode === "LIVE" && env.NODE_ENV !== "production") blockers.push("LIVE collection is forbidden in Development.");
  return { enabled, mode, secret, webhookHash, publicBase, blockers };
}
export function hostedAmounts(hasBro: boolean, feeMinor: number | null) {
  const platform = hasBro ? HOSTED_POLICY.platformWithBroMinor : HOSTED_POLICY.platformWithoutBroMinor;
  if (feeMinor !== null && (!Number.isSafeInteger(feeMinor) || feeMinor < 0 || feeMinor >= platform)) {
    throw new HostedPaymentError(409, "FEE_REVIEW_REQUIRED", "Provider fees require financial review.");
  }
  return { grossMinor: HOSTED_POLICY.grossMinor, schoolDueMinor: HOSTED_POLICY.schoolMinor,
    broDueMinor: hasBro ? HOSTED_POLICY.broMinor : 0,
    platformNetMinor: feeMinor === null ? null : platform - feeMinor };
}

/**
 * Compared EXACTLY with installed pg_proc.prosrc before runtime writes.
 * Declaration for an isolated Development rehearsal, not startup/deploy DDL.
 * Managed Publish is not assumed to preserve this function or its two bindings.
 */
export const HOSTED_HISTORY_GUARD_BODY = `
BEGIN
  RAISE EXCEPTION 'Hosted payment history is append-only';
END`;
