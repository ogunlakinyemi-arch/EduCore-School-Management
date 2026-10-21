import { createHash } from "node:crypto";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";

/** Claims are untrusted diagnostics, never verification or refund evidence.
 * Keep names/values bounded and exclude headers, customer, bank and arbitrary metadata.
 * Fingerprint deduplication is byte-identical delivery deduplication only.
 */
function diagnosticClaims(rawBody: Buffer): Record<string, string> {
  let event: unknown;
  try { event = JSON.parse(rawBody.toString("utf8")); } catch { return { shape: "INVALID_JSON" }; }
  if (!event || typeof event !== "object" || Array.isArray(event)) return { shape: "UNSUPPORTED" };
  const source = event as Record<string, unknown>;
  const data = source.data && typeof source.data === "object" && !Array.isArray(source.data)
    ? source.data as Record<string, unknown> : source;
  const claims: Record<string, string> = {};
  const copy = (name: string, value: unknown, pattern: RegExp) => {
    if ((typeof value === "string" || typeof value === "number" && Number.isSafeInteger(value))
      && pattern.test(String(value))) claims[name] = String(value);
  };
  copy("event", source.event, /^[a-z][a-z._-]{0,79}$/);
  copy("reference", data.tx_ref, /^[A-Za-z0-9_-]{8,100}$/);
  copy("transactionId", data.TransactionId ?? data.id, /^[1-9][0-9]{0,15}$/);
  copy("status", data.status, /^[A-Za-z._-]{1,40}$/);
  copy("currency", data.currency, /^[A-Z]{3}$/);
  // Preserve only exact textual claims, never round or treat a payload amount as verified.
  copy("amount", data.AmountRefunded ?? data.amount, /^\d{1,12}(?:\.\d{1,2})?$/);
  return claims;
}

/** ONLY call after LIVE-bound adapter authentication.
 * Writes an isolated receipt, never a payment/hold/allocation, and never authorizes 200.
 * No raw payload is retained: provider redelivery or separately authorized evidence
 * ingestion is required for any future processing. No replay worker is supplied.
 */
export async function persistAuthenticatedLiveWebhookReceipt(
  pool: StudentSubscriptionSqlPool,
  rawBody: Buffer,
): Promise<number> {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 65_536) {
    throw new Error("LIVE webhook receipt body is invalid");
  }
  const digest = createHash("sha256").update(rawBody).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '3s'");
    const receipt=await client.query(
      `INSERT INTO flutterwave_live_webhook_receipts
        (provider,environment,payload_sha256,payload_bytes,claims,signature_verified)
       VALUES ('FLUTTERWAVE','LIVE',$1,$2,$3::jsonb,true)
       ON CONFLICT (provider,environment,payload_sha256) DO UPDATE
         SET delivery_count=CASE WHEN flutterwave_live_webhook_receipts.delivery_count < 2147483647
               THEN flutterwave_live_webhook_receipts.delivery_count+1 ELSE 2147483647 END,
             last_received_at=NOW() RETURNING id`,
      [digest, rawBody.length, JSON.stringify(diagnosticClaims(rawBody))],
    );
    const id=Number(receipt.rows[0]?.id);
    if(!Number.isSafeInteger(id)||id<=0)throw new Error("LIVE receipt identity unavailable");
    await client.query("COMMIT");
    return id;
  } catch (error) {
    // Includes uncertain COMMIT: do not claim success; exact redelivery is safe.
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
