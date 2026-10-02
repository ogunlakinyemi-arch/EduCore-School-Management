import { Router } from "express";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";

export function verifiedReceipt(provider: "resend" | "termii", body: Buffer, headers: Record<string, unknown>, secret: string, now = Date.now()): boolean {
  if (!secret) return false;
  const equal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
  if (provider === "termii") {
    const signature = headers["x-termii-signature"];
    return typeof signature === "string" && /^[a-f0-9]{128}$/i.test(signature) &&
      equal(Buffer.from(signature, "hex"), createHmac("sha512", secret).update(body).digest());
  }
  const id = headers["svix-id"], timestamp = headers["svix-timestamp"], signatures = headers["svix-signature"];
  if (typeof id !== "string" || id.length > 200 || typeof timestamp !== "string" || !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 || typeof signatures !== "string") return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const digest = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();
  return signatures.split(" ").some(value => value.startsWith("v1,") && equal(Buffer.from(value.slice(3), "base64"), digest));
}

const router = Router();
router.post("/:provider", async (req, res) => {
  const provider = req.params.provider;
  if (provider !== "resend" && provider !== "termii") { res.status(404).end(); return; }
  const secret = provider === "resend" ? process.env.RESEND_WEBHOOK_SECRET : process.env.TERMII_API_KEY;
  if (!secret) { res.status(503).json({ error: "Receipt verification is not configured" }); return; }
  if (!Buffer.isBuffer(req.body) || !verifiedReceipt(provider, req.body, req.headers, secret)) {
    res.status(401).json({ error: "Invalid receipt" }); return;
  }
  const c = await pool.connect();
  try {
    const event = JSON.parse(req.body.toString("utf8"));
    const messageId = provider === "resend" ? event.data?.email_id : event.message_id;
    const delivered = provider === "resend" ? event.type === "email.delivered" : event.status === "Delivered";
    const failed = provider === "resend" ? ["email.bounced","email.failed"].includes(event.type) : ["Failed","Rejected","Undelivered"].includes(event.status);
    if (typeof messageId !== "string" || messageId.length > 200 || (!delivered && !failed)) { res.status(204).end(); return; }
    const receiptId = provider === "resend" ? String(req.headers["svix-id"]) : createHash("sha256").update(req.body).digest("hex");
    await c.query("BEGIN");
    const rows = await c.query(`SELECT id FROM communication_deliveries WHERE provider_name=$1
      AND channel=$2 AND provider_message_id=$3 AND provider_acknowledged_at IS NOT NULL
      AND error_code IS DISTINCT FROM 'SIMULATED' FOR UPDATE`, [provider, provider === "resend" ? "EMAIL" : "SMS", messageId]);
    // No payload-supplied recipient or school can select records. Ambiguous IDs fail closed.
    if (rows.rows.length === 1) {
      await c.query(`UPDATE communication_deliveries SET status=$2,
        delivered_at=CASE WHEN $2='DELIVERED' THEN NOW() ELSE delivered_at END,
        failed_at=CASE WHEN $2='FAILED' THEN NOW() ELSE failed_at END,
        receipt_ids=(SELECT jsonb_agg(value) FROM (
          SELECT value FROM jsonb_array_elements(receipt_ids || $3::jsonb) WITH ORDINALITY
          ORDER BY ordinality DESC LIMIT 100) latest),updated_at=NOW()
        WHERE id=$1 AND status IN ('SENT','FAILED') AND NOT receipt_ids @> $3::jsonb`,
        [rows.rows[0].id, delivered ? "DELIVERED" : "FAILED", JSON.stringify([receiptId])]);
    }
    await c.query("COMMIT"); res.status(204).end();
  } catch {
    await c.query("ROLLBACK").catch(() => undefined); res.status(400).json({ error: "Receipt could not be processed" });
  } finally { c.release(); }
});
export default router;