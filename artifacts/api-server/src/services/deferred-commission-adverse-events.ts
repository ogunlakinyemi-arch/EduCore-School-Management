import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { isSplitDevelopment } from "../lib/flutterwave-split-policy";

/** Call ONLY after the existing provider adapter verifies the webhook signature.
 * Adverse webhooks put liabilities on hold; they NEVER prove refund completion,
 * bank recovery, payment activation or Partner transfer success. */
export async function holdSignedDeferredAdverseEvent(rawBody: Buffer): Promise<boolean> {
  if (!isSplitDevelopment()) return false;
  let event: any;
  try {event=JSON.parse(rawBody.toString("utf8"));} catch {return false;}
  const type=event?.event, data=event?.data;
  if (typeof type !== "string" || !data || typeof data !== "object"
      || !(type === "refund.completed" || /^chargeback\.(initiated|accepted|declined|lost|won|reversed)$/.test(type)
        || type === "charge.completed" && ["reversed","refunded","failed"].includes(String(data.status).toLowerCase()))) return false;
  const ref=typeof data.tx_ref==="string" ? data.tx_ref : null;
  const flw=typeof data.flw_ref==="string" ? data.flw_ref : null;
  if ((!ref && !flw) || (ref?.length ?? 0)>200 || (flw?.length ?? 0)>200) return false;
  const hash=createHash("sha256").update(rawBody).digest("hex");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const matches=(await client.query(`SELECT s.payment_id,s.reference,s.provider_flw_reference
      FROM flutterwave_split_payments s JOIN student_subscription_payments p ON p.id=s.payment_id
      WHERE left(s.reference,5)='SCV3_' AND p.provider='FLUTTERWAVE' AND p.provider_mode='SANDBOX'
        AND (($1::text IS NOT NULL AND s.reference=$1) OR ($2::text IS NOT NULL AND s.provider_flw_reference=$2))
      FOR UPDATE OF s,p`,[ref,flw])).rows;
    if(matches.length!==1 || ref && matches[0].reference!==ref || flw && matches[0].provider_flw_reference!==flw) {
      await client.query("COMMIT"); return false;
    }
    const paymentId=matches[0].payment_id;
    const inserted=(await client.query(`INSERT INTO deferred_commission_adverse_events(event_hash,payment_id,event_type)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_hash`,[hash,paymentId,type])).rows;
    if(inserted.length) {
      await client.query(`UPDATE flutterwave_split_payments SET status='COLLECTION_EXCEPTION',
        reconciliation_note='Signed adverse webhook received; independent refund/chargeback reconciliation required'
        WHERE payment_id=$1`,[paymentId]);
      await client.query(`INSERT INTO audit_logs("user",role,action,module,record_id,metadata)
        VALUES('Flutterwave verified webhook','SYSTEM','Held deferred commission for adverse event',
        'Partner Commission Batches',$1,$2::jsonb)`,[paymentId,JSON.stringify({eventType:type,eventHash:hash})]);
    }
    await client.query("COMMIT"); return true;
  } catch(error) {await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally {client.release();}
}
