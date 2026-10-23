import fs from "node:fs";
import path from "node:path";
import { hash } from "./native.mjs";

const names=["webhook-inbox","finalization","workflow","readiness"];
const reverse=[...names].reverse();
export function emptyBaseline(r,sources) {
  const db="rehearsal_empty";r.create(db);
  const original=r.catalog(db);
  r.apply(db,sources,"readiness","up","42P01");
  r.equal(r.catalog(db),original,"wrong dependency order is atomic");
  return {db,original};
}
export async function finishEmpty(r,sources,{db,original}) {
  for(const name of names.slice(0,3))r.apply(db,sources,name);
  await r.lockReadiness(db,sources);
  r.apply(db,sources,"readiness");
  const complete=r.catalog(db,true);
  r.check(complete.tables.length===14&&complete.indexes.length===40&&complete.functions.length===5
    &&complete.triggers.length===14&&complete.constraints.filter(c=>c.kind==="f").length===19
    &&complete.constraints.every(c=>c.validated)&&complete.indexes.every(i=>i.valid&&i.ready),"installed native objects and validation");
  fs.writeFileSync(path.join(r.evidence,"empty-live-inventory.json"),JSON.stringify(complete,null,2)+"\n");
  r.report.inventory=Object.fromEntries(Object.entries(complete).map(([key,items])=>[key,items.length]));
  r.report.inventory.foreignKeys=19;
  for(const name of names) {
    r.apply(db,sources,name,"up","42P07");
    r.equal(r.catalog(db,true),complete,"one-shot duplicate apply is atomic: "+name);
  }
  r.apply(db,sources,"finalization","down","2BP01");
  r.equal(r.catalog(db,true),complete,"wrong rollback order is atomic");
  for(const name of reverse)r.apply(db,sources,name,"down");
  r.equal(r.catalog(db),original,"empty reverse returns to starting catalog");
  for(const name of names)r.apply(db,sources,name);
  r.equal(r.catalog(db,true),complete,"empty reverse/reapply reproduces exact canonical LIVE objects");
}

const intent=(reference,student,partner="NULL",accrual=0,extraColumns="",extraValues="")=>`INSERT INTO flutterwave_live_subscription_intents
  (merchant_scope,reference,school_id,student_id,session_id,term_id,term_end_date,school_subaccount_id,partner_profile_id,partner_accrual_minor${extraColumns})
  VALUES('merchant_fixture_live','${reference}',10,${student},1,1,CURRENT_DATE-1,'RS_FictionalSchool123',${partner},${accrual}${extraValues});`;
const dataAndCatalog=(r,db)=>({catalog:r.catalog(db),data:r.data(db)});
const same=(r,db,before,label)=>{r.equal(r.catalog(db),before.catalog,label+" catalog");r.equal(r.data(db),before.data,label+" rows");};
export function populatedBaseline(r,sources,baseline) {
  const db="rehearsal_populated";r.create(db);
  r.sql(db,baseline,"reviewed-source-model-baseline");
  r.sql(db,`INSERT INTO app_users(id,clerk_user_id,email) VALUES(7,'fictional_isolated_owner','fixture@example.invalid');
    INSERT INTO schools(id,code,name,city,state) VALUES(10,'ISOLATED-FIXTURE','Fictional school','Fixture city','Fixture state');
    INSERT INTO students(id,school_id,admission_no,first_name,last_name,gender,class_name,section)
      VALUES(1,10,'SYNTHETIC-1','Synthetic','Student','other','Fixture Class','A');
    INSERT INTO subscriptions(id,school_id,student_id,term,status,verification_status,provider,provider_reference,expires_at)
      VALUES(1,10,1,'Historical synthetic term','active','verified','test','SCV2_isolated_retained',now()+interval '30 days');
    CREATE TABLE rehearsal_scv2_financial_history(reference text PRIMARY KEY,snapshot jsonb NOT NULL);
    INSERT INTO rehearsal_scv2_financial_history VALUES('SCV2_isolated_retained',
      '{"fictional":true,"policyVersion":2,"grossMinor":500000,"schoolMinor":190000,"partnerMinor":10000,"deferredPartner":false,"originalReceipt":"SCV2_synthetic_receipt"}');`,
    "fictional-SCV2-shared-history-sentinels");
  const before={catalog:r.catalog(db,false),data:r.data(db,false)};
  r.apply(db,sources,"webhook-inbox");
  r.sql(db,`INSERT INTO flutterwave_live_webhook_receipts(payload_sha256,payload_bytes,claims,signature_verified)
    VALUES(repeat('a',64),10,'{"fictional":true}',true);`,"synthetic-earlier-inbox-evidence");
  r.apply(db,sources,"finalization");
  r.sql(db,intent("SCV3_isolated_eligible",1,"77",10000)+intent("SCV3_isolated_no_partner",2),"synthetic-earlier-design-intents");
  const prior=r.json(db,"SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM flutterwave_live_subscription_intents i;");
  r.apply(db,sources,"workflow");r.apply(db,sources,"readiness");
  r.equal(r.json(db,`SELECT jsonb_agg(to_jsonb(i)-'issued_by'-'issuer_key'-'authority_review_id'-'authority_snapshot' ORDER BY id)
    FROM flutterwave_live_subscription_intents i;`),prior,"populated earlier drafts retain all original intent fields");
  r.check(r.json(db,`SELECT jsonb_build_object('ok',bool_and(state='PENDING' AND issued_by IS NULL AND authority_review_id IS NULL AND authority_snapshot IS NULL))
    FROM flutterwave_live_subscription_intents;`).ok,"legacy design intents are not promoted to activation or authority");
  return {db,before};
}
export function policyAndRetention(r,sources,{db,before}) {
  for(const [n,column,value] of [
    [10,"gross_minor","400000"],[11,"school_minor","180000"],[12,"merchant_gross_minor","320000"],
    [13,"environment","'TEST'"],[14,"partner_accrual_minor","10000"],
  ]) {
    const sql=intent("SCV3_invalid_policy_"+n,n).replace(",partner_profile_id",`,${column},partner_profile_id`).replace(",'RS_FictionalSchool123',NULL",`,'RS_FictionalSchool123',${value},NULL`);
    // partner_accrual_minor is already a supplied column; handle that case directly.
    r.sql(db,column==="partner_accrual_minor"?intent("SCV3_invalid_policy_"+n,n,"NULL",10000):sql,"reject-fixed-policy-"+column,"23514");
  }
  r.sql(db,intent("SCV3_invalid_partner_amount",15,"77",9999),"reject-nonexact-eligible-payable","23514");
  r.sql(db,intent("SCV2_cannot_be_live_intent",16),"reject-SCV2-reference-in-SCV3","23514");
  r.sql(db,`INSERT INTO flutterwave_live_authority_reviews(merchant_scope,school_id,school_subaccount_id,evidence_sha256,reviewed_by,expires_at)
    VALUES('merchant_fixture_live',10,'RS_FictionalSchool123',repeat('c',64),7,now()+interval '1 day');`,"synthetic-authority-snapshot");
  r.sql(db,intent("SCV3_cross_school_authority",17,"NULL",0,",issued_by,issuer_key,authority_review_id,authority_snapshot",",7,'isolated-authority-0001',1,'{}'")
    .replace("',10,17,","',20,17,"),"reject-cross-school-authority","23503");
  r.sql(db,`UPDATE flutterwave_live_subscription_intents SET verified_transaction_id=(100+id)::text,
    verified_provider_reference='synthetic-proof-'||id,state='COLLECTION_VERIFIED';
    INSERT INTO flutterwave_live_collection_evidence(intent_id,merchant_scope,school_subaccount_id,transaction_id,provider_reference,
      gross_minor,currency,school_minor,merchant_gross_minor,partner_accrual_minor,provider_fee_minor,additional_fee_minor)
      SELECT id,merchant_scope,school_subaccount_id,verified_transaction_id,verified_provider_reference,500000,'NGN',190000,310000,
        partner_accrual_minor,6500,500 FROM flutterwave_live_subscription_intents;
    INSERT INTO flutterwave_live_partner_accruals(intent_id,partner_profile_id,amount_minor,state) VALUES(1,77,10000,'ACCRUED');
    INSERT INTO flutterwave_live_finalization_events(intent_id,semantic_key,kind,transaction_id,source_payload_sha256)
      VALUES(1,repeat('b',64),'COLLECTION','101',repeat('a',64));
    INSERT INTO flutterwave_live_receipt_results(receipt_id,event_id) VALUES(1,1);
    INSERT INTO flutterwave_live_subscription_activations(intent_id,status,expires_at)
      VALUES(1,'ACTIVE',now()+interval '30 days'),(2,'ACTIVE',now()+interval '30 days');
    INSERT INTO flutterwave_live_official_receipts(intent_id,receipt_number,snapshot)
      VALUES(1,'SYNTHETIC-LIVE-1','{"fictional":true}'),(2,'SYNTHETIC-LIVE-2','{"fictional":true}');
    INSERT INTO flutterwave_live_reconciliation_cases(receipt_id,reason_code) VALUES(1,'VERIFICATION_OR_FINALIZATION_UNRESOLVED');
    INSERT INTO flutterwave_live_commission_batches(merchant_scope,idempotency_key,request_hash,approved_by,snapshot)
      VALUES('merchant_fixture_live','isolated-batch-0001',repeat('d',64),7,'{"fictional":true,"exportOnly":true}');
    INSERT INTO flutterwave_live_commission_items(batch_id,intent_id) VALUES(1,1);
    INSERT INTO flutterwave_live_workflow_audits(actor_id,action,batch_id) VALUES(7,'EXPORT_ONLY',1);
    INSERT INTO flutterwave_live_operator_reviews(merchant_scope,receipt_id,actor_id,idempotency_key,request_hash,action,reason,outcome)
      VALUES('merchant_fixture_live',1,7,'isolated-review-0001',repeat('e',64),'REVIEW','UNCERTAIN_COMMIT','EVIDENCE_REQUIRED');`,
    "synthetic-complete-SCV3-evidence-no-runtime-activation");
  r.check(r.json(db,`SELECT jsonb_build_object('ok',bool_and(gross_minor=500000 AND school_minor=190000 AND merchant_gross_minor=310000
    AND calculated_merchant_remainder_minor=303000 AND calculated_owner_net_minor=303000-partner_accrual_minor))
    FROM flutterwave_live_collection_evidence;`).ok,"SCV3 fixed amounts and generated synthetic fee arithmetic");
  r.check(r.json(db,`SELECT jsonb_build_object('ok',count(*)::int=1 AND min(amount_minor)=10000 AND min(state)='ACCRUED') FROM flutterwave_live_partner_accruals;`).ok,
    "only eligible Partner has exact NGN100 internal payable");
  r.sql(db,`INSERT INTO flutterwave_live_webhook_receipts(payload_sha256,payload_bytes,claims,signature_verified)
    VALUES(repeat('a',64),10,'{"fictional":true}',true)
    ON CONFLICT(provider,environment,payload_sha256) DO UPDATE SET delivery_count=flutterwave_live_webhook_receipts.delivery_count+1;`,
    "supported-receipt-redelivery-idempotency");
  r.check(r.json(db,`SELECT jsonb_build_object('ok',count(*)::int=1 AND min(id)=1 AND min(delivery_count)=2) FROM flutterwave_live_webhook_receipts;`).ok,
    "new connection reconciles committed immutable receipt identity without duplicate receipt");
  r.sql(db,`INSERT INTO flutterwave_live_finalization_events(intent_id,semantic_key,kind,transaction_id,source_payload_sha256)
    VALUES(2,repeat('b',64),'ADVERSE_HOLD','102',repeat('a',64));`,"semantic-event-dedup","23505");
  r.sql(db,`INSERT INTO flutterwave_live_finalization_events(intent_id,semantic_key,kind,transaction_id,source_payload_sha256)
    VALUES(1,repeat('f',64),'COLLECTION','101',repeat('a',64));`,"intent-kind-dedup","23505");
  for(const table of ["flutterwave_live_collection_evidence","flutterwave_live_official_receipts","flutterwave_live_operator_reviews"]) {
    r.sql(db,`DELETE FROM ${table};`,"immutable-history-delete-"+table,"P0001");
  }
  r.sql(db,"UPDATE flutterwave_live_subscription_intents SET on_hold=true WHERE id=1;","synthetic-intent-hold");
  r.sql(db,"UPDATE flutterwave_live_subscription_intents SET on_hold=false WHERE id=1;","intent-hold-never-released","P0001");
  r.sql(db,"UPDATE flutterwave_live_partner_accruals SET state='HELD' WHERE intent_id=1;","synthetic-accrual-hold");
  r.check(r.json(db,"SELECT jsonb_build_object('ok',status='REVIEW_REQUIRED') FROM flutterwave_live_commission_batches WHERE id=1;").ok,
    "held payable invalidates export approval without treating it as paid");
  r.sql(db,"UPDATE flutterwave_live_partner_accruals SET state='ACCRUED' WHERE intent_id=1;","payable-hold-never-released","P0001");
  const retained=dataAndCatalog(r,db);
  for(const name of reverse) {
    r.apply(db,sources,name,"down","P0001");
    same(r,db,retained,"retained evidence blocks "+name+" rollback");
  }
  r.equal(r.catalog(db,false),before.catalog,"complete canonical shared schema preserved");
  r.equal(r.data(db,false),before.data,"all fields of canonical SCV2/shared sentinels preserved");
  fs.writeFileSync(path.join(r.evidence,"populated-live-inventory.json"),JSON.stringify(r.catalog(db,true),null,2)+"\n");
  r.report.sharedPreservation={schemaSha256:hash(JSON.stringify(before.catalog)),rowFingerprintSha256:hash(JSON.stringify(before.data)),
    tables:before.data.length,scope:"full source-model schema with fictional canonical and explicit historical SCV2 sentinels, not application data"};
  return retained;
}
export function incompatibleBaseline(r,sources) {
  const db="rehearsal_incompatible";r.create(db);
  for(const name of names.slice(0,3))r.apply(db,sources,name);
  r.sql(db,`INSERT INTO flutterwave_live_authority_reviews(merchant_scope,school_id,school_subaccount_id,evidence_sha256,reviewed_by,expires_at)
    VALUES('merchant_fixture_live',10,'RS_FictionalSchool123',repeat('c',64),7,now()-interval '1 day');`,"synthetic-incompatible-earlier-authority");
  const before=dataAndCatalog(r,db);
  r.apply(db,sources,"readiness","up","23514");
  same(r,db,before,"incompatible populated readiness upgrade is refused atomically");
  r.report.incompatibleBaseline="Expected 23514; retained expired synthetic authority not modified, deleted or waived.";
}
