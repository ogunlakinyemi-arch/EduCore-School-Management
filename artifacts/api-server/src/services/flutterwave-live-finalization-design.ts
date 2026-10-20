import { createHash } from "node:crypto";
import type { StudentSubscriptionSqlPool, StudentSubscriptionSqlClient } from "../lib/student-subscription-billing";
import { parseLiveFinalizationEvent } from "../lib/flutterwave-live-finalization-event";
import {
  blockedLiveCollectionVerifier, LiveFinalizationBlocked,
  type LiveCollectionEvidence, type LiveCollectionVerifier,
} from "../lib/flutterwave-live-verification";

function blocked(code: string): never { throw new LiveFinalizationBlocked(code); }
function validateEvidence(proof: LiveCollectionEvidence, intent: any, event: ReturnType<typeof parseLiveFinalizationEvent>) {
  if (!proof || proof.environment !== "LIVE" || proof.merchantScope !== intent.merchant_scope
    || proof.reference !== intent.reference || proof.transactionId !== event.transactionId
    || proof.status !== "succeeded" || proof.currency !== "NGN" || proof.amountMinor !== 500000
    || proof.chargedAmountMinor !== 500000 || typeof proof.providerReference !== "string"
    || !proof.providerReference.length || proof.providerReference.length > 200
    || event.providerReference !== null && event.providerReference !== proof.providerReference
    || intent.verified_transaction_id !== null && intent.verified_transaction_id !== proof.transactionId
    || intent.verified_provider_reference !== null && intent.verified_provider_reference !== proof.providerReference
    || !Number.isSafeInteger(proof.providerFeeMinor) || proof.providerFeeMinor < 0
    || !Number.isSafeInteger(proof.additionalFeeMinor) || proof.additionalFeeMinor < 0
    || proof.providerFeeMinor + proof.additionalFeeMinor >= 310000 - intent.partner_accrual_minor
    || proof.recipientEvidence !== "TRANSACTION_BOUND" || !Array.isArray(proof.recipients)
    || proof.recipients.length !== 1 || proof.recipients[0]?.subaccountId !== intent.school_subaccount_id
    || proof.recipients[0]?.currency !== "NGN" || proof.recipients[0]?.amountMinor !== 190000) {
    blocked("LIVE_VERIFICATION_MISMATCH");
  }
}

async function verifyBounded(verifier: LiveCollectionVerifier, intent: any, transactionId: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      verifier.verify({ reference: intent.reference, transactionId, currency: "NGN", amountMinor: 500000,
        schoolSubaccountId: intent.school_subaccount_id, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new LiveFinalizationBlocked("LIVE_VERIFICATION_TIMEOUT"));
        }, 3000);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * OFFLINE DESIGN ONLY. Not imported by any route, worker, factory or checkout.
 * The default verifier is unconditionally disabled before DB access.
 * Tests explicitly inject fictional independent evidence and a disposable pool.
 * Even a committed result is not operational processing/activation/HTTP200 authority.
 */
export async function finalizeLiveSubscriptionDesign(
  pool: StudentSubscriptionSqlPool,
  receiptId: number,
  rawBody: Buffer,
  verifier: LiveCollectionVerifier = blockedLiveCollectionVerifier,
  lifecycle?: {
    collection(client: StudentSubscriptionSqlClient, intent: any, receiptId: number): Promise<void>;
    hold(client: StudentSubscriptionSqlClient, intent: any, receiptId: number): Promise<void>;
  },
) {
  if (!verifier.enabled || verifier.environment !== "LIVE"
    || !/^[A-Za-z0-9_-]{8,80}$/.test(verifier.merchantScope)) blocked("LIVE_VERIFICATION_TRANSPORT_DISABLED");
  if (!Number.isSafeInteger(receiptId) || receiptId <= 0 || !Buffer.isBuffer(rawBody)
    || !rawBody.length || rawBody.length > 65536) blocked("LIVE_RECEIPT_INVALID");
  const hash = createHash("sha256").update(rawBody).digest("hex");
  const event = parseLiveFinalizationEvent(rawBody);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '3s'");
    const receipt = (await client.query(
      `SELECT id FROM flutterwave_live_webhook_receipts WHERE id=$1 AND environment='LIVE'
         AND provider='FLUTTERWAVE' AND signature_verified=true AND payload_sha256=$2 FOR UPDATE`,
      [receiptId, hash],
    )).rows[0];
    if (!receipt) blocked("LIVE_AUTHENTICATED_RECEIPT_MISMATCH");
    const intents = (await client.query(
      `SELECT * FROM flutterwave_live_subscription_intents WHERE environment='LIVE' AND merchant_scope=$1
         AND (reference=$2 OR verified_transaction_id=$3) FOR UPDATE`,
      [verifier.merchantScope, event.reference, event.transactionId],
    )).rows;
    if (intents.length !== 1 || event.reference !== null && event.reference !== intents[0].reference) {
      blocked("LIVE_INTENT_UNMATCHED");
    }
    const intent = intents[0];
    // A matched signed adverse notification must protect an ALREADY independently
    // verified collection even if fresh GETs fail or now report a reversal.
    // Reuse immutable original evidence for a HOLD ONLY, never a new collection.
    const original = event.kind === "ADVERSE_HOLD" ? (await client.query(
      `SELECT * FROM flutterwave_live_collection_evidence WHERE intent_id=$1 AND environment='LIVE'`,
      [intent.id],
    )).rows[0] : null;
    const proof: LiveCollectionEvidence = original ? {
      environment: "LIVE", merchantScope: original.merchant_scope, reference: intent.reference,
      transactionId: original.transaction_id, providerReference: original.provider_reference,
      status: "succeeded", currency: original.currency, amountMinor: original.gross_minor,
      chargedAmountMinor: original.gross_minor, providerFeeMinor: original.provider_fee_minor,
      additionalFeeMinor: original.additional_fee_minor, recipientEvidence: "TRANSACTION_BOUND",
      recipients: [{ subaccountId: original.school_subaccount_id, currency: original.currency, amountMinor: original.school_minor }],
    } : await verifyBounded(verifier, intent, event.transactionId);
    validateEvidence(proof, intent, event);
    await client.query(
      `UPDATE flutterwave_live_subscription_intents SET verified_transaction_id=$2,verified_provider_reference=$3
         WHERE id=$1 AND environment='LIVE'`,
      [intent.id, proof.transactionId, proof.providerReference],
    );
    const semanticKey = createHash("sha256")
      .update(JSON.stringify(["LIVE", intent.merchant_scope, intent.reference, proof.transactionId, event.kind])).digest("hex");
    const inserted = (await client.query(
      `INSERT INTO flutterwave_live_finalization_events
         (intent_id,environment,semantic_key,kind,transaction_id,source_payload_sha256)
       VALUES ($1,'LIVE',$2,$3,$4,$5) ON CONFLICT (intent_id,kind) DO NOTHING RETURNING id`,
      [intent.id, semanticKey, event.kind, proof.transactionId, hash],
    )).rows;
    const eventId = inserted[0]?.id ?? (await client.query(
      `SELECT id FROM flutterwave_live_finalization_events WHERE intent_id=$1 AND environment='LIVE' AND semantic_key=$2`,
      [intent.id, semanticKey],
    )).rows[0]?.id;
    if (!eventId) blocked("LIVE_EVENT_CONFLICT");
    if (event.kind === "ADVERSE_HOLD") {
      await client.query(
        `UPDATE flutterwave_live_subscription_intents SET on_hold=true,state='REVIEW_REQUIRED' WHERE id=$1 AND environment='LIVE'`,
        [intent.id],
      );
      await client.query(
        `UPDATE flutterwave_live_partner_accruals SET state='HELD' WHERE intent_id=$1 AND environment='LIVE'`,
        [intent.id],
      );
      await lifecycle?.hold(client,intent,receiptId);
    } else if (!intent.on_hold) {
      const existing = (await client.query(
        `SELECT * FROM flutterwave_live_collection_evidence WHERE intent_id=$1 AND environment='LIVE'`,
        [intent.id],
      )).rows[0];
      if (existing && (existing.transaction_id !== proof.transactionId
        || existing.provider_fee_minor !== proof.providerFeeMinor || existing.additional_fee_minor !== proof.additionalFeeMinor)) {
        blocked("LIVE_IMMUTABLE_EVIDENCE_CHANGED");
      }
      await client.query(
        `INSERT INTO flutterwave_live_collection_evidence
           (intent_id,environment,merchant_scope,school_subaccount_id,transaction_id,provider_reference,
            gross_minor,currency,school_minor,merchant_gross_minor,partner_accrual_minor,provider_fee_minor,additional_fee_minor)
         VALUES ($1,'LIVE',$2,$3,$4,$5,500000,'NGN',190000,310000,$6,$7,$8)
         ON CONFLICT (intent_id) DO NOTHING`,
        [intent.id, intent.merchant_scope, intent.school_subaccount_id, proof.transactionId, proof.providerReference,
          intent.partner_accrual_minor, proof.providerFeeMinor, proof.additionalFeeMinor],
      );
      if (intent.partner_profile_id !== null) {
        await client.query(
          `INSERT INTO flutterwave_live_partner_accruals (intent_id,environment,partner_profile_id,amount_minor,state)
           VALUES ($1,'LIVE',$2,10000,'ACCRUED') ON CONFLICT (intent_id) DO NOTHING`,
          [intent.id, intent.partner_profile_id],
        );
      }
      await client.query(
        `UPDATE flutterwave_live_subscription_intents SET state='COLLECTION_VERIFIED' WHERE id=$1 AND environment='LIVE'`,
        [intent.id],
      );
      await lifecycle?.collection(client,intent,receiptId);
    }
    await client.query(
      `INSERT INTO flutterwave_live_receipt_results (receipt_id,environment,event_id)
       VALUES ($1,'LIVE',$2) ON CONFLICT (receipt_id) DO NOTHING`,
      [receiptId, eventId],
    );
    const result = (await client.query(
      `SELECT event_id FROM flutterwave_live_receipt_results WHERE receipt_id=$1 AND environment='LIVE'`,
      [receiptId],
    )).rows[0];
    if (!result || String(result.event_id) !== String(eventId)) blocked("LIVE_RECEIPT_RESULT_CONFLICT");
    await client.query("COMMIT");
    return {
      outcome: event.kind === "ADVERSE_HOLD" || intent.on_hold ? "HELD" as const : "COLLECTION_VERIFIED" as const,
      duplicate: inserted.length === 0,
      operationallyProcessed: false as const,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
