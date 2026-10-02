import type { CommunicationDispatchPool } from "./communication-service";
import type { PushProvider, ProviderSendResult, WebPushSubscription } from "./communication-providers";
import { clerkClient } from "@clerk/express";

type Device = { id: number; subscription: WebPushSubscription; sessionId: string | null };
type State = { status: string; retryable?: boolean };
/** Fanout lives inside the existing notification/channel delivery; no second outbox. */
export async function dispatchPushDevices(pool: CommunicationDispatchPool, record: {
  id: number | string; recipientUserId: number | string; schoolId: number | string | null; notificationId: number | string;
}, provider?: PushProvider, sessionActive: (id: string) => Promise<boolean | null> = async id => {
  try { return (await clerkClient.sessions.getSession(id)).status === "active"; } catch (e) {
    return (e as {status?:number}).status === 404 ? false : null;
  }
}): Promise<ProviderSendResult> {
  const failure = (category: "CONFIGURATION" | "INVALID_REQUEST" | "UNKNOWN" | "RATE_LIMITED", retryable = false): ProviderSendResult =>
    ({ provider: provider?.provider ?? "web-push", channel: "push", status: "FAILED", accepted: false, delivered: false,
      failure: { category, retryable } });
  if (!provider) return failure("CONFIGURATION");
  if ("configured" in provider && !provider.configured) return failure("CONFIGURATION");
  const saved = await pool.query<{ pushAttempts: Record<string, State> }>(
    `SELECT push_attempts AS "pushAttempts" FROM communication_deliveries WHERE id=$1 AND status='PROCESSING'`, [record.id]);
  if (!saved.rows[0]) return failure("UNKNOWN");
  const states = saved.rows[0].pushAttempts ?? {};
  const devices = await pool.query<Device>(`SELECT id,subscription,session_id AS "sessionId" FROM communication_push_devices
    WHERE user_id=$1 AND school_id IS NOT DISTINCT FROM $2::integer AND status='ACTIVE'
    AND subscription IS NOT NULL ORDER BY id LIMIT 10`, [record.recipientUserId, record.schoolId]);
  let accepted = false; let simulated = false; let retry = false; let uncertain = false;
  for (const device of devices.rows) {
    const session = device.sessionId ? await sessionActive(device.sessionId) : false;
    if (session === null) { uncertain = true; continue; }
    if (!session) {
      await pool.query(`UPDATE communication_push_devices SET status='REVOKED',revoked_at=NOW()
        WHERE id=$1 AND user_id=$2`, [device.id, record.recipientUserId]);
      continue;
    }
    const prior = states[String(device.id)];
    if (prior?.status === "ACCEPTED") { accepted = true; continue; }
    if (prior?.status === "SIMULATED") { simulated = true; continue; }
    if (prior && prior.status !== "RETRY") { if (prior.status === "PROCESSING") uncertain = true; continue; }
    // Durable per-device claim before the external request. Never reset after a crash.
    const claim = await pool.query(`UPDATE communication_deliveries
      SET push_attempts=jsonb_set(push_attempts,ARRAY[$2::text], '{"status":"PROCESSING"}'::jsonb,true)
      WHERE id=$1 AND status='PROCESSING' RETURNING id`, [record.id, String(device.id)]);
    if (!claim.rows.length) { uncertain = true; break; }
    let result: ProviderSendResult;
    try { result = await provider.send({ subscription: device.subscription,
      idempotencyKey: `communication-${record.notificationId}-push-${device.id}` }); }
    catch { result = failure("UNKNOWN"); }
    accepted ||= result.accepted;
    simulated ||= result.status === "SIMULATED";
    const ambiguous = ["NETWORK", "TIMEOUT", "UNKNOWN"].includes(result.failure?.category ?? "");
    uncertain ||= ambiguous;
    const canRetry = result.failure?.retryable === true && !ambiguous;
    retry ||= canRetry;
    await pool.query(`UPDATE communication_deliveries
      SET push_attempts=jsonb_set(push_attempts,ARRAY[$2::text],$3::jsonb,true) WHERE id=$1`,
      [record.id, String(device.id), JSON.stringify({ status: ambiguous ? "PROCESSING" : canRetry ? "RETRY" : result.status })]);
    if (result.failure?.category === "INVALID_REQUEST") {
      await pool.query(`UPDATE communication_push_devices SET status='REVOKED',revoked_at=NOW()
        WHERE id=$1 AND user_id=$2 AND school_id IS NOT DISTINCT FROM $3::integer`, [device.id, record.recipientUserId, record.schoolId]);
    }
  }
  if (uncertain) return failure("UNKNOWN");
  if (retry) return failure("RATE_LIMITED", true);
  if (accepted || simulated) return { provider: provider.provider, channel: "push", status: accepted ? "ACCEPTED" : "SIMULATED",
    accepted, delivered: false };
  return failure("INVALID_REQUEST");
}