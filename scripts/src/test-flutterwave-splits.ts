/**
 * PostgreSQL-backed UNIT tests, with MOCKED provider HTTP.
 * Disposable socket-only database mandatory. Not genuine sandbox evidence.
 * Never creates recipients, payments or audit fixtures in Development/Production.
 */
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { prepareSplitCheckout } from "../../artifacts/api-server/src/services/flutterwave-split-checkout";
import { finalizeVerifiedStudentSubscriptionPayment } from "../../artifacts/api-server/src/lib/student-subscription-billing";
import { requestSplitRefund,verifySplitRefund } from "../../artifacts/api-server/src/services/flutterwave-split-refunds";
import { reconcileSplitPayment } from "../../artifacts/api-server/src/services/flutterwave-split-reporting";
import { encryptSplitBank,splitBankFingerprint } from "../../artifacts/api-server/src/services/flutterwave-split-crypto";
import type { VerifiedPayment } from "../../artifacts/api-server/src/lib/fee-providers";

let passed = 0;
const check = async(name: string, fn: () => Promise<void>) => { await fn(); ++passed; console.log("PASS",name); };
const rows = async(sql: string,args: any[] = []) => (await pool.query(sql,args)).rows;
const identity = (await rows(
  "SELECT current_database() db,inet_server_addr() address,current_setting('port') port,current_setting('data_directory') dir",
))[0];
assert.equal(identity.db,"postgres"); assert.equal(identity.address,null);
assert.equal(identity.port,"55493"); assert.match(identity.dir,/^\/tmp\/educore-flw-split-[A-Za-z0-9]+\/data$/);
process.env.NODE_ENV="development"; delete process.env.REPLIT_DEPLOYMENT;
process.env.SESSION_SECRET="UNIT-ONLY-session-secret-bank-key-at-least-32";
process.env.FLUTTERWAVE_SECRET_Test_Key="FLWSECK_TEST-unit-not-real-provider-credential";
delete process.env.FLUTTERWAVE_TEST_SECRET_KEY;
const schoolSid = "RS_UNITSchool000001",partnerSid = "RS_UNITPartner00001";
const bank = {bankCode:"044",accountNumber:"0123456789",accountName:"UNIT ONLY SCHOOL",entityName:"UNIT ONLY SCHOOL",contactPhone:"08000000000"};
try {
  await pool.query(`
    INSERT INTO app_users(id,clerk_user_id,email) VALUES(1,'unit_disposable_actor','actor@example.test'),(2,'unit_disposable_owner','owner@example.test');
    INSERT INTO schools(id,code,name,city,state) VALUES(1,'UNIT_FLW_1','UNIT ONLY SCHOOL','Unit','Unit'),(2,'UNIT_FLW_2','UNIT ONLY FOREIGN SCHOOL','Unit','Unit');
    INSERT INTO academic_sessions(id,school_id,name,start_date,end_date,is_current,status)
      VALUES(1,1,'UNIT 2026/27','2026-01-01','2027-12-31',true,'ACTIVE');
    INSERT INTO academic_terms(id,school_id,academic_session_id,name,start_date,end_date,is_current,status)
      VALUES(1,1,1,'FIRST','2026-01-01','2027-12-31',true,'ACTIVE');
    INSERT INTO partner_profiles(id,partner_code,full_name,email,status) VALUES(1,'UNIT_PP','UNIT ONLY PARTNER','partner@example.test','ACTIVE');
    INSERT INTO commission_rules(id,name,status,currency,term,effective_at) VALUES(1,'UNIT fixed shares','ACTIVE','NGN','FIRST','2020-01-01');
  `);
  async function recipient(kind: string, entityId: number, sid: string, number: string) {
    const b = {...bank,accountNumber:number};
    return (await rows(
      `INSERT INTO flutterwave_split_recipients(kind,school_id,partner_profile_id,entity_name,bank_ciphertext,bank_fingerprint,
       account_last4,bank_name,status,provider_id,provider_subaccount_id,submitted_by,reviewed_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,'UNIT BANK','TEST_READY',$8,$9,1,2) RETURNING id`,
      [kind,kind==="SCHOOL"?entityId:null,kind==="PARTNER"?entityId:null,b.entityName,encryptSplitBank(b),
        splitBankFingerprint(b.bankCode,number),number.slice(-4),sid===schoolSid?10:sid===partnerSid?11:12,sid],
    ))[0].id;
  }
  const schoolRecipient = await recipient("SCHOOL",1,schoolSid,bank.accountNumber);
  const partnerRecipient = await recipient("PARTNER",1,partnerSid,"1123456789");
  const foreignRecipient = await recipient("SCHOOL",2,"RS_UNITForeign00001","2123456789");
  await rows("INSERT INTO flutterwave_split_settings(school_id,enabled,automatic_settlement_confirmed,reviewed_by) VALUES(1,true,true,2)");
  let sequence = 0;
  async function payment() {
    const n = ++sequence;
    const st = (await rows(
      "INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section) VALUES(1,$1,'UNIT','STUDENT','Male','UNIT CLASS','A') RETURNING id",
      [`UNIT_STUDENT_${n}`],
    ))[0].id;
    const sub = (await rows(
      "INSERT INTO subscriptions(school_id,student_id,term,expires_at,amount,status,verification_status) VALUES(1,$1,'FIRST','2027-12-31',5000,'pending','pending') RETURNING id", [st],
    ))[0].id;
    return (await rows(
      `INSERT INTO student_subscription_payments(subscription_id,school_id,student_id,academic_session_id,academic_term_id,
       payer_user_id,provider,provider_mode,reference,idempotency_key) VALUES($1,1,$2,1,1,1,'FLUTTERWAVE','SANDBOX',$3,$4) RETURNING *`,
      [sub,st,`fee_unit_pg_split_${n}`,`unit_pg_split_${n}`],
    ))[0];
  }
  const without = await payment();
  await check("PostgreSQL freezes school2000/platform3000 with no eligible partner",async() => {
    assert.equal((await prepareSplitCheckout(without.id))!.length,1);
    assert.equal((await rows("SELECT platform_amount_minor FROM flutterwave_split_payments WHERE payment_id=$1",[without.id]))[0].platform_amount_minor,300000);
  });
  await rows("INSERT INTO school_partner_attributions(id,school_id,partner_profile_id,status,is_current,starts_at) VALUES(1,1,1,'ACTIVE',true,'2020-01-01')");
  const p = await payment();
  await check("PostgreSQL freezes the eligible attribution and fixed two-recipient plan",async() => {
    assert.deepEqual((await prepareSplitCheckout(p.id))!.map(s => s.transaction_charge),[2000,100]);
    assert.equal((await rows("SELECT attribution_id FROM flutterwave_split_payments WHERE payment_id=$1",[p.id]))[0].attribution_id,1);
  });
  await check("database rejects mutation of frozen recipient/financial instructions",async() => {
    await assert.rejects(rows("UPDATE flutterwave_split_payments SET school_recipient_id=$1 WHERE payment_id=$2",[foreignRecipient,p.id]),/immutable/);
    await assert.rejects(rows("UPDATE flutterwave_split_recipients SET school_id=2 WHERE id=$1",[schoolRecipient]),/immutable/);
  });
  await check("database rejects a foreign school recipient for a new payment",async() => {
    const foreign = await payment();
    await assert.rejects(rows(
      `INSERT INTO flutterwave_split_payments(payment_id,school_id,student_id,subscription_id,session_id,term_id,reference,
        school_recipient_id,instructions,platform_amount_minor)
       VALUES($1,1,$2,$3,1,1,$4,$5,'[]',300000)`,
      [foreign.id,foreign.student_id,foreign.subscription_id,foreign.reference,foreignRecipient],
    ),/foreign school recipient/);
  });
  await check("unverified eligible partner blocks checkout, with no fallback share",async() => {
    await rows("UPDATE flutterwave_split_recipients SET status='SUSPENDED' WHERE id=$1",[partnerRecipient]);
    const missing = await payment();
    await assert.rejects(prepareSplitCheckout(missing.id),/Eligible partner/);
    assert.equal((await rows("SELECT 1 FROM flutterwave_split_payments WHERE payment_id=$1",[missing.id])).length,0);
    await rows("UPDATE flutterwave_split_recipients SET status='TEST_READY' WHERE id=$1",[partnerRecipient]);
  });
  const verified: VerifiedPayment = {reference:p.reference,amountMinor:500000,currency:"NGN",providerTransactionId:"778899",
    status:"succeeded",paidAt:new Date().toISOString(),providerFeeMinor:7000,providerChargedAmountMinor:500000,providerCostComponents:{appFeeMinor:7000,additionalFeeMinor:525}};
  await check("real finalizer records gross shares, separate platform fee expenses and prevents manual Partner payout",async() => {
    const result = await finalizeVerifiedStudentSubscriptionPayment(pool,p.id,verified);
    assert.equal(result.activated,true);
    assert.equal((await rows("SELECT provider_fee_minor FROM student_subscription_payments WHERE id=$1",[p.id]))[0].provider_fee_minor,7525);
    assert.equal((await rows("SELECT status FROM commission_ledger WHERE subscription_id=$1",[p.subscription_id]))[0].status,"HELD");
  });
  const receipt = (await rows("SELECT receipt_snapshot FROM student_subscription_payments WHERE id=$1",[p.id]))[0].receipt_snapshot;
  const allocations = await rows("SELECT * FROM student_subscription_allocations WHERE payment_id=$1 ORDER BY id",[p.id]);
  await check("duplicate verified callbacks do not duplicate receipts or financial allocations",async() => {
    for (let i=0;i<3;i++) assert.equal((await finalizeVerifiedStudentSubscriptionPayment(pool,p.id,verified)).activated,true);
    assert.deepEqual(await rows("SELECT * FROM student_subscription_allocations WHERE payment_id=$1 ORDER BY id",[p.id]),allocations);
    assert.deepEqual((await rows("SELECT receipt_snapshot FROM student_subscription_payments WHERE id=$1",[p.id]))[0].receipt_snapshot,receipt);
  });
  await check("failed split creates no successful allocations and does not activate",async() => {
    const failed = await payment(); await prepareSplitCheckout(failed.id);
    assert.equal((await finalizeVerifiedStudentSubscriptionPayment(pool,failed.id,{...verified,reference:failed.reference,providerTransactionId:"778890",status:"failed"})).activated,false);
    assert.equal((await rows("SELECT 1 FROM student_subscription_allocations WHERE payment_id=$1",[failed.id])).length,0);
    assert.equal((await rows("SELECT status FROM flutterwave_split_payments WHERE payment_id=$1",[failed.id]))[0].status,"COLLECTION_FAILED");
  });
  // Mock provider transport is permitted only inside this guarded UNIT process.
  const oldFetch = globalThis.fetch;
  let refundId=900, refundPosts=0;
  const refunds = new Map<string,any>();
  globalThis.fetch = async(url, init) => {
    const path = new URL(String(url)).pathname;
    let data: any;
    if (init?.method === "POST" && path.endsWith("/refund")) {
      ++refundPosts;
      const amount = JSON.parse(String(init.body)).amount;
      data={id:refundId++,transaction_id:778899,amount_refunded:amount,status:"completed"};
      refunds.set(String(data.id),{...data,status:"completed-bank-transfer"});
    } else if (path.includes("/refunds/")) data=refunds.get(path.split("/").at(-1)!);
    else if (path.endsWith("/settlements")) data=[{id:1000}];
    else if (path.endsWith("/settlements/1000")) data={id:1000,currency:"NGN",bank_code:"044",settlement_account:"0123456789",
      status:"completed",disburse_ref:"UNIT",processed_date:"2026-10-11T10:00:00Z",refund:0,chargeback:0,
      transactions:[{id:778899,tx_ref:p.reference,currency:"NGN",status:"successful",settlement_amount:1999}]};
    else throw new Error("UNIT transport forbids unplanned provider request");
    return new Response(JSON.stringify({status:"success",data}),{status:200});
  };
  try {
    await check("routed settlement mismatch does not claim bank payment or create extra credits",async() => {
      const report = await reconcileSplitPayment(p.id);
      assert.equal(report.status,"REPORT_EXCEPTION");
      assert.equal(report.recipients[0].status,"MISMATCH");
      assert.deepEqual(await rows("SELECT * FROM student_subscription_allocations WHERE payment_id=$1 ORDER BY id",[p.id]),allocations);
    });
    await check("partial refund intent/replay posts once and only independent completion appends recovery",async() => {
      const input={amountMinor:250000,reason:"UNIT approved partial refund",idempotencyKey:"unit_refund_first"};
      const refund=await requestSplitRefund(p.id,2,input);
      assert.equal(refund.status,"PROCESSING");
      assert.equal((await requestSplitRefund(p.id,2,input)).id,refund.id);
      assert.equal(refundPosts,1);
      const confirmed=await verifySplitRefund(refund.id);
      assert.equal(confirmed.status,"CONFIRMED");
      assert.equal(confirmed.schoolRecoveryMinor,100000); assert.equal(confirmed.partnerRecoveryMinor,5000);
      assert.deepEqual(await verifySplitRefund(refund.id),confirmed);
      assert.equal((await rows("SELECT status FROM subscriptions WHERE id=$1",[p.subscription_id]))[0].status,"active");
    });
    await check("remaining full refund suspends only its bound subscription and preserves original receipt",async() => {
      const refund=await requestSplitRefund(p.id,2,{amountMinor:250000,reason:"UNIT remaining customer refund",idempotencyKey:"unit_refund_second"});
      await verifySplitRefund(refund.id);
      assert.equal((await rows("SELECT status FROM subscriptions WHERE id=$1",[p.subscription_id]))[0].status,"pending");
      assert.deepEqual((await rows("SELECT receipt_snapshot FROM student_subscription_payments WHERE id=$1",[p.id]))[0].receipt_snapshot,receipt);
      assert.deepEqual(await rows("SELECT * FROM student_subscription_allocations WHERE payment_id=$1 ORDER BY id",[p.id]),allocations);
      await assert.rejects(requestSplitRefund(p.id,2,{amountMinor:10000,reason:"UNIT forbidden excess refund",idempotencyKey:"unit_refund_excess"}));
    });
    await check("refunded callback cannot generate duplicate or unjustified credits",async() => {
      const result=await finalizeVerifiedStudentSubscriptionPayment(pool,p.id,verified);
      assert.equal(result.activated,false); assert.equal(result.reconciliationRequired,true);
      assert.deepEqual(await rows("SELECT * FROM student_subscription_allocations WHERE payment_id=$1 ORDER BY id",[p.id]),allocations);
    });
  } finally { globalThis.fetch=oldFetch; }
  console.log(JSON.stringify({passed,scope:"DISPOSABLE POSTGRESQL UNIT TESTS",provider:"MOCKED; NOT GENUINE SANDBOX"}));
} finally { await pool.end(); }
