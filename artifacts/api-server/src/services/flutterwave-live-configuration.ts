import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { liveSplitAuthorityDigest } from "../lib/flutterwave-live-split-authority";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";
import { requireLiveRelease } from "../lib/flutterwave-live-release";
import { FlutterwaveLiveTransport } from "../lib/flutterwave-live-transport";

/** Owner-reviewed configuration, not a provider subaccount creation endpoint.
 * Can be prepared with release flags OFF after separately approved target DDL.
 * No school IDs, credentials or bank details are fabricated or obtained from TEST. */
export async function saveLiveSchoolConfiguration(pool:StudentSubscriptionSqlPool,input:{
  actorId:number;evidence:unknown;expiresAt:string;
}) {
  const digest=liveSplitAuthorityDigest(input.evidence);
  const evidence=input.evidence as {merchantScope:string;schoolId:number;schoolSubaccountId:string};
  const expiry=new Date(input.expiresAt).getTime();
  if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+30*86400_000)
    throw new LiveFinalizationBlocked("LIVE_REVIEW_EXPIRY_INVALID");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='3s'");
    const owner=(await client.query(`SELECT au.id FROM app_users au JOIN school_memberships sm ON sm.user_id=au.id
      WHERE au.id=$1 AND au.status='ACTIVE' AND sm.role='PLATFORM_OWNER' AND sm.school_id IS NULL
        AND sm.status='ACTIVE' FOR SHARE OF au,sm`,[input.actorId])).rows[0];
    const school=(await client.query("SELECT id FROM schools WHERE id=$1 FOR SHARE",[evidence.schoolId])).rows[0];
    if(!owner||!school)throw new LiveFinalizationBlocked("LIVE_CONFIGURATION_AUTHORITY_DENIED");
    const review=(await client.query(`INSERT INTO flutterwave_live_authority_reviews
      (merchant_scope,school_id,school_subaccount_id,evidence_sha256,reviewed_by,expires_at)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[evidence.merchantScope,evidence.schoolId,evidence.schoolSubaccountId,
      digest,input.actorId,input.expiresAt])).rows[0];
    await client.query(`INSERT INTO flutterwave_live_school_configuration
      (merchant_scope,school_id,authority_review_id,authority_evidence) VALUES($1,$2,$3,$4::jsonb)`,
    [evidence.merchantScope,evidence.schoolId,review.id,JSON.stringify(input.evidence)]);
    await client.query("COMMIT");
    return {recorded:true,reviewId:review.id,operationallyEnabled:false};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

/** Explicit Owner review of an actual transaction-specific provider report.
 * Real GET readback binds the transaction, ref, charged amount, fees and flw_ref.
 * Approval of a checkout instruction or an unbound report is NOT accepted. */
export async function saveLiveAllocationReview(pool:StudentSubscriptionSqlPool,input:{
  actorId:number;reference:string;transactionId:string;evidenceSha256:string;
  schoolSubaccountId:string;providerReference:string;grossMinor:500000;schoolMinor:190000;
  currency:"NGN";source:"FLUTTERWAVE_TRANSACTION_REPORT";
},env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch) {
  const release=await requireLiveRelease(pool,env);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='3s'");
    const owner=(await client.query(`SELECT au.id FROM app_users au JOIN school_memberships sm ON sm.user_id=au.id
      WHERE au.id=$1 AND au.status='ACTIVE' AND sm.role='PLATFORM_OWNER' AND sm.school_id IS NULL
        AND sm.status='ACTIVE' FOR SHARE OF au,sm`,[input.actorId])).rows[0];
    const intent=(await client.query(`SELECT * FROM flutterwave_live_subscription_intents
      WHERE environment='LIVE' AND merchant_scope=$1 AND reference=$2 AND school_subaccount_id=$3 FOR SHARE`,
    [release.merchantScope,input.reference,input.schoolSubaccountId])).rows[0];
    if(!owner||!intent||input.grossMinor!==500000||input.schoolMinor!==190000||input.currency!=="NGN"
      ||input.source!=="FLUTTERWAVE_TRANSACTION_REPORT"||!/^[a-f0-9]{64}$/.test(input.evidenceSha256))
      throw new LiveFinalizationBlocked("LIVE_ALLOCATION_REVIEW_INVALID");
    const proof=await new FlutterwaveLiveTransport(env,fetcher).collection(input.transactionId,input.reference);
    if(proof.providerReference!==input.providerReference)throw new LiveFinalizationBlocked("LIVE_ALLOCATION_REVIEW_INVALID");
    const saved=await client.query(`INSERT INTO flutterwave_live_allocation_reviews
      (merchant_scope,reference,transaction_id,provider_reference,school_subaccount_id,currency,
       gross_minor,school_minor,provider_fee_minor,additional_fee_minor,source,evidence_sha256,reviewed_by)
      VALUES($1,$2,$3,$4,$5,'NGN',500000,190000,$6,$7,$8,$9,$10)
      ON CONFLICT(merchant_scope,reference) DO NOTHING RETURNING reference`,
    [release.merchantScope,input.reference,input.transactionId,input.providerReference,input.schoolSubaccountId,
      proof.providerFeeMinor,proof.additionalFeeMinor,input.source,input.evidenceSha256,input.actorId]);
    if(!saved.rows.length){
      const prior=(await client.query(`SELECT * FROM flutterwave_live_allocation_reviews
        WHERE merchant_scope=$1 AND reference=$2`,[release.merchantScope,input.reference])).rows[0];
      if(!prior||prior.transaction_id!==input.transactionId||prior.school_subaccount_id!==input.schoolSubaccountId
        ||prior.provider_reference!==input.providerReference||prior.evidence_sha256!==input.evidenceSha256)
        throw new LiveFinalizationBlocked("LIVE_ALLOCATION_REVIEW_CONFLICT");
    }
    await client.query("COMMIT");
    return {recorded:true,duplicate:!saved.rows.length,paid:false};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
