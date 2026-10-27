import { randomUUID } from "node:crypto";
import type { StudentSubscriptionSqlClient,StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { decryptPayrollBankValue } from "../lib/payroll-bank-encryption";
import { HostedPaymentError, HOSTED_POLICY } from "../lib/hosted-manual-policy";
import { bankFingerprint, payoutHash, schoolPayoutConfiguration, FlutterwaveSchoolPayoutProvider,
  type SchoolPayoutProvider,type PayoutBank } from "../lib/flutterwave-school-payout";
import { sourceHash } from "./flutterwave-live-school-onboarding";
import { appendHostedEvent, hostedDatabaseReady, hostedOrderView, hostedTransaction, loadHostedOrder,
  type HostedActor,type HostedRow } from "./hosted-payment-store";
import { receiptDate } from "./payment-receipts";

type Client=StudentSubscriptionSqlClient;
const deny=(message:string):never=>{throw new HostedPaymentError(409,"SCHOOL_PAYOUT_BLOCKED",message);};
export class HostedSchoolPayouts {
  constructor(private pool:StudentSubscriptionSqlPool,private env:NodeJS.ProcessEnv=process.env,
    private suppliedProvider?:SchoolPayoutProvider) {}
  private provider(readOnly=false) {
    const c=schoolPayoutConfiguration(this.env);
    const blockers=readOnly?c.readBlockers:c.blockers;
    if(blockers.length) return deny(blockers.join(" "));
    return this.suppliedProvider??new FlutterwaveSchoolPayoutProvider(c.secret!);
  }
  private async owner(c:Client,actor:HostedActor) {
    if(!actor.owner || actor.id<1) throw new HostedPaymentError(403,"OWNER_REQUIRED","Only an active Platform Owner may authorize school payouts.");
    const r=await c.query(`SELECT u.id FROM app_users u JOIN school_memberships m ON m.user_id=u.id
      WHERE u.id=$1 AND u.status='ACTIVE' AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL AND m.status='ACTIVE'
      FOR SHARE OF u,m`,[actor.id]);
    if(!r.rows.length) throw new HostedPaymentError(403,"OWNER_REQUIRED","Platform Owner authority is no longer active.");
  }
  private async events(c:Client,reference:string) {
    return (await c.query(`SELECT * FROM hosted_checkout_events WHERE order_reference=$1 ORDER BY created_at,id`,[reference])).rows;
  }
  private async reserved(c:Client,mode:string) {
    const r=await c.query(`SELECT COALESCE(sum((claim.data->>'reservedMinor')::bigint),0) AS reserved
      FROM hosted_checkout_events claim WHERE claim.kind='SCHOOL_PAYOUT_CLAIMED' AND claim.environment=$1
      AND NOT EXISTS(SELECT 1 FROM hosted_checkout_events terminal WHERE terminal.order_reference=claim.order_reference
        AND terminal.kind IN ('SCHOOL_PAYOUT_SUCCESS','SCHOOL_PAYOUT_FAILED'))`,[mode]);
    const n=Number(r.rows[0]?.reserved);
    if(!Number.isSafeInteger(n)||n<0) return deny("Outstanding funding reservations require review.");
    return n;
  }
  private async bank(c:Client,order:HostedRow,lock=false) {
    const r=(await c.query(`SELECT p.*,s.name AS school_name,s.status AS school_status FROM settlement_payroll_profiles p
      JOIN schools s ON s.id=p.school_id WHERE p.scope='SCHOOL' AND p.school_id=$1${lock?" FOR SHARE OF p,s":""}`,[order.school_id])).rows[0];
    if(!r || String(r.school_status).toLowerCase()!=="active" || r.verification_status!=="VERIFIED" || !r.verified_at || !r.verified_by)
      return deny("An active school with an Owner-verified settlement bank profile is required.");
    const field=(name:string,col:string)=>decryptPayrollBankValue(r[col],r.encryption_key_version,`settlement:school:${order.school_id}:${name}`);
    let bank:PayoutBank,bankName:string;
    try {
      bank={bankCode:field("bankCode","bank_code_encrypted"),accountNumber:field("accountNumber","account_number_encrypted"),accountName:field("accountName","account_name_encrypted")};
      bankName=field("bankName","bank_name_encrypted");
    } catch { return deny("The saved school bank profile cannot be decrypted with the configured bank encryption key."); }
    if(r.currency!=="NGN" || r.provider!=="FLUTTERWAVE" || !/^\d{3,6}$/.test(bank.bankCode) ||
      !/^\d{10}$/.test(bank.accountNumber)||bank.accountName.trim().length<2)
      return deny("A valid NGN Flutterwave bank code, account number and approved beneficiary name are required.");
    let subaccountId=r.provider_subaccount_id??null;
    if(order.environment==="LIVE") {
      const scope=this.env.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE;
      if(!scope) return deny("EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE is missing for LIVE beneficiary ownership review.");
      const live=await c.query(`SELECT provider_subaccount_id FROM flutterwave_live_school_onboarding
        WHERE merchant_scope=$1 AND school_id=$2 AND profile_id=$3 AND snapshot_sha256=$4
          AND status='LIVE_VERIFIED' AND provider_subaccount_id IS NOT NULL FOR SHARE`,
      [scope,order.school_id,r.id,sourceHash(r)]);
      if(live.rows.length!==1) return deny("A LIVE-verified school ownership/subaccount binding matching the current bank profile is missing.");
      subaccountId=live.rows[0].provider_subaccount_id;
    }
    return {bank,fingerprint:bankFingerprint(bank),
      token:payoutHash([order.reference,order.environment,190000,r.id,sourceHash(r),subaccountId]),
      display:{schoolName:String(r.school_name),bankName,bankCode:bank.bankCode,accountName:bank.accountName,
        maskedAccount:`••••${bank.accountNumber.slice(-4)}`,subaccountId,subaccountStatus:order.environment==="LIVE"?"LIVE_VERIFIED":
          subaccountId?"Bank profile approved; TEST subaccount not independently checked":"No collection subaccount recorded"}};
  }
  private eligible(o:HostedRow,v:Awaited<ReturnType<typeof hostedOrderView>>,mode:string) {
    if(o.environment!==mode || o.provider!=="FLUTTERWAVE" || o.policy!==HOSTED_POLICY.code ||
      v.status!=="PAID" || v.hold || v.schoolSettled) return deny("Only an unheld, verified successful NGN 5,000 hosted payment with an unpaid school liability in the selected mode is eligible.");
  }
  async preview(actor:HostedActor,reference:string) {
    const cfg=schoolPayoutConfiguration(this.env),blockers=[...cfg.blockers];
    if(!await hostedDatabaseReady(this.pool)) blockers.push("Additive hosted journal schema and exact append-only guards are not installed/verified.");
    const result=await hostedTransaction(this.pool,async c=>{
      await this.owner(c,actor);
      const o=await loadHostedOrder(c,reference),v=await hostedOrderView(c,o),events=await this.events(c,reference);
      const claim=events.find(e=>e.kind==="SCHOOL_PAYOUT_CLAIMED");
      if(v.schoolPayoutFeeReviewRequired) blockers.push("The provider-reported transfer fee exceeded the authorised ceiling. Payment succeeded; review the actual provider debit before further financial action.");
      let recipient=claim?.data?.recipient??null,confirmationToken:string|null=null,bank:PayoutBank|null=null;
      try {
        this.eligible(o,v,cfg.mode);
        if(claim) blockers.push("A transfer reference is already reserved. Reconcile it; never send a new transfer.");
        else {const b=await this.bank(c,o);recipient=b.display;confirmationToken=b.token;bank=b.bank;}
      } catch(e) {blockers.push(e instanceof HostedPaymentError?e.message:"School bank/subaccount evidence is unavailable.");}
      const schema=await c.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='hosted_checkout_events'::regclass AND conname='hosted_events_kind_ck'`);
      if(!String(schema.rows[0]?.definition).includes("SCHOOL_PAYOUT_RECEIPT")) blockers.push("School payout event schema has not been installed.");
      return {paymentReference:reference,schoolId:Number(o.school_id),schoolName:String(o.school_name??recipient?.schoolName??`School ${o.school_id}`),
        mode:cfg.mode,paymentStatus:v.status,status:v.schoolSettlementStatus,amountMinor:190000,
        recipient,confirmationToken,transferReference:claim?.external_reference??null,transferId:v.schoolPayoutTransferId,
        receiptId:v.settlementReceiptId,bank,availableBalanceMinor:null as number|null,feeQuoteMinor:null as number|null,
        bankVerifiedAt:null as string|null,reservedMinor:await this.reserved(c,cfg.mode)};
    });
    if(!blockers.length && result.bank) try {
      const p=await this.provider().preflight(result.bank);
      result.availableBalanceMinor=p.availableMinor;result.feeQuoteMinor=p.feeMinor;
      result.bankVerifiedAt=p.verifiedAt;
      if(p.feeMinor>cfg.maxFeeMinor) blockers.push("The quoted transfer fee exceeds the configured Owner fee ceiling.");
      if(p.availableMinor-result.reservedMinor<190000+cfg.maxFeeMinor)
        blockers.push("Available merchant NGN balance, after outstanding reservations, cannot cover NGN 1,900 plus the fee ceiling. Checkout funds may not yet be available.");
    } catch(e) {blockers.push(e instanceof HostedPaymentError?e.message:"Fresh Flutterwave bank verification, transfer fee or available-balance check could not be confirmed.");}
    const {bank,...safe}=result;
    return {...safe,fundingSource:"MERCHANT_NGN_BALANCE",maxFeeMinor:cfg.maxFeeMinor,blockers,ready:!blockers.length};
  }
  async pay(actor:HostedActor,reference:string,input:{confirmationToken:string;confirmed:true}) {
    if(input.confirmed!==true) return deny("Explicit Owner confirmation is required.");
    const cfg=schoolPayoutConfiguration(this.env);
    // Fresh authority check happens before checking configuration or making any provider request.
    await hostedTransaction(this.pool,c=>this.owner(c,actor));
    const provider=this.provider();
    if(!await hostedDatabaseReady(this.pool)) return deny("Hosted journal guards are not verified.");
    const reservation=await hostedTransaction(this.pool,async c=>{
      await this.owner(c,actor);
      const o=await loadHostedOrder(c,reference,true),v=await hostedOrderView(c,o);
      const events=await this.events(c,reference),claim=events.find(e=>e.kind==="SCHOOL_PAYOUT_CLAIMED");
      if(claim) return {send:false as const}; // Retried request never repeats provider POST, even after failure.
      this.eligible(o,v,cfg.mode);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`school-payout-funding:${cfg.mode}`]);
      const bank=await this.bank(c,o,true);
      if(input.confirmationToken!==bank.token) return deny("The school recipient or payment changed. Review the beneficiary again before confirming.");
      const fresh=await provider.preflight(bank.bank),reserved=await this.reserved(c,cfg.mode);
      if(fresh.feeMinor>cfg.maxFeeMinor || fresh.availableMinor-reserved<190000+cfg.maxFeeMinor ||
        (v.platformNetMinor!==null && cfg.maxFeeMinor>=v.platformNetMinor))
        return deny("Fresh available funding or the approved transfer-fee ceiling is insufficient.");
      const transferReference=`HSP1_${cfg.mode==="LIVE"?"L":"T"}_${randomUUID().replaceAll("-","")}`;
      const inserted=await appendHostedEvent(c,o,"SCHOOL_PAYOUT_CLAIMED","school-payout-claim",{
        actorId:actor.id,amount:190000,externalReference:transferReference,data:{ownerConfirmed:true,
          bankFingerprint:bank.fingerprint,recipient:bank.display,feeCeilingMinor:cfg.maxFeeMinor,
          reservedMinor:190000+cfg.maxFeeMinor,bankVerifiedAt:fresh.verifiedAt,fundingSource:"MERCHANT_NGN_BALANCE"}});
      return {send:inserted,bank:bank.bank,transferReference};
    });
    // Commit acknowledgement is required before POST. Commit uncertainty leaves a reserved reference, not a resend.
    if(reservation.send && reservation.bank && reservation.transferReference) {
      try {
        await hostedTransaction(this.pool,async c=>{
          await this.owner(c,actor);
          const o=await loadHostedOrder(c,reference,true);
          this.eligible(o,await hostedOrderView(c,o),cfg.mode);
          const current=await this.bank(c,o,true);
          if(current.token!==input.confirmationToken) return deny("The approved beneficiary changed before dispatch; no replacement transfer is permitted.");
          // The durable claim already committed. Lock current authority/payment/profile through the sole POST.
          const accepted=await provider.initiate(reservation.bank!,reservation.transferReference!);
          await appendHostedEvent(c,o,"SCHOOL_PAYOUT_ACCEPTED","school-payout-accepted",
            {actorId:actor.id,transactionId:accepted.id,data:{status:"PROCESSING"}});
        });
      } catch {
        await hostedTransaction(this.pool,async c=>{
          const o=await loadHostedOrder(c,reference,true);
          await appendHostedEvent(c,o,"SCHOOL_PAYOUT_UNCERTAIN","school-payout-uncertain",
            {actorId:actor.id,data:{reason:"TRANSFER_ACCEPTANCE_OR_PERSISTENCE_UNCERTAIN"}});
        });
      }
    }
    return this.preview(actor,reference);
  }
  async reconcile(actor:HostedActor,reference:string) {
    const cfg=schoolPayoutConfiguration(this.env);
    const before=await hostedTransaction(this.pool,async c=>{
      await this.owner(c,actor);
      const o=await loadHostedOrder(c,reference),events=await this.events(c,reference);
      if(o.environment!==cfg.mode) return deny("Transfer reconciliation requires the original configured mode.");
      const claim=events.find(e=>e.kind==="SCHOOL_PAYOUT_CLAIMED");
      if(!claim) return deny("No school transfer has been reserved.");
      return claim;
    });
    if(!await hostedDatabaseReady(this.pool)) return deny("Hosted journal guards are not verified.");
    const provider=this.provider(true);
    let verified;
    try { verified=await provider.find(before.external_reference); }
    catch { verified=null; }
    await hostedTransaction(this.pool,async c=>{
      await this.owner(c,actor);
      const o=await loadHostedOrder(c,reference,true),events=await this.events(c,reference);
      if(events.some(e=>e.kind==="SCHOOL_PAYOUT_SUCCESS")) return;
      const claim=events.find(e=>e.kind==="SCHOOL_PAYOUT_CLAIMED")!;
      const accepted=events.find(e=>e.kind==="SCHOOL_PAYOUT_ACCEPTED");
      const matches=verified && verified.reference===claim.external_reference && verified.currency==="NGN" &&
        (verified.debitCurrency==="NGN" || (!verified.debitCurrency&&claim.data.fundingSource==="MERCHANT_NGN_BALANCE")) &&
        verified.amountMinor===190000 &&
        verified.bankFingerprint===claim.data.bankFingerprint &&
        (!accepted?.provider_transaction_id || accepted.provider_transaction_id===verified.id);
      if(!matches) {
        await appendHostedEvent(c,o,"SCHOOL_PAYOUT_UNCERTAIN",`school-payout-unverified:${randomUUID()}`,
          {actorId:actor.id,data:{reason:verified?"TRANSFER_VERIFICATION_MISMATCH":"TRANSFER_NOT_YET_INDEPENDENTLY_VERIFIED"}});
        return;
      }
      const kind=verified!.status==="SUCCESS"?"SCHOOL_PAYOUT_SUCCESS":verified!.status==="FAILED"?"SCHOOL_PAYOUT_FAILED":"SCHOOL_PAYOUT_STATUS";
      await appendHostedEvent(c,o,kind,kind==="SCHOOL_PAYOUT_STATUS"?`${kind}:${randomUUID()}`:`${kind}:${verified!.id}:${verified!.status}`,{
        actorId:actor.id,transactionId:verified!.id,amount:190000,fee:verified!.feeMinor,
        externalReference:claim.external_reference,data:{status:verified!.status,verification:"FLUTTERWAVE_GET_TRANSFER",
          feeRaw:verified!.feeRaw,feeCeilingExceeded:verified!.feeMinor>Number(claim.data.feeCeilingMinor)}});
    });
    return this.preview(actor,reference);
  }
  async attachReceipt(actor:HostedActor,reference:string,input:{proofReceiptId:string;settlementDate:string}) {
    await hostedTransaction(this.pool,async c=>{
      await this.owner(c,actor);
      const o=await loadHostedOrder(c,reference,true),events=await this.events(c,reference);
      const success=events.find(e=>e.kind==="SCHOOL_PAYOUT_SUCCESS"),paid=events.find(e=>e.kind==="PAYMENT_VERIFIED");
      if(!success || !paid) return deny("Proof may only be attached after independently verified transfer success.");
      const r=await c.query(`SELECT * FROM payment_receipt_uploads WHERE id=$1 AND state='AVAILABLE' FOR SHARE`,[input.proofReceiptId]);
      const row=r.rows[0],format=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"});
      if(!row || row.kind!=="SCHOOL_SETTLEMENT" || row.target_id!==reference || Number(row.school_id)!==Number(o.school_id) ||
        Number(row.amount_minor)!==190000 || receiptDate(row.transfer_date)!==input.settlementDate ||
        input.settlementDate<format.format(new Date(paid.created_at)) || input.settlementDate>format.format(new Date()))
        return deny("Attach the matching school/payment/amount/date receipt.");
      const prior=events.find(e=>e.kind==="SCHOOL_PAYOUT_RECEIPT");
      if(prior && prior.data.receiptId!==row.id) return deny("The transfer already has immutable receipt evidence.");
      await appendHostedEvent(c,o,"SCHOOL_PAYOUT_RECEIPT","school-payout-receipt",{
        actorId:actor.id,proofSha256:row.sha256,data:{receiptId:row.id,receiptUploadedBy:Number(row.uploaded_by),settlementDate:input.settlementDate}});
    });
    return this.preview(actor,reference);
  }
}
