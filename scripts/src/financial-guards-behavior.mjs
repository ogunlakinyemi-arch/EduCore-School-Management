// Called only by the independently bound disposable PostgreSQL runner.
import assert from "node:assert/strict";
export async function exerciseFinancialGuards({pool,check,repair,financialGuardTriggers,inspect}){
  await pool.query(`
    INSERT INTO schools VALUES(2);
    INSERT INTO students VALUES(2,1,'ACTIVE','ADMITTED');
    INSERT INTO partner_profiles VALUES(1,'ACTIVE'),(2,'ACTIVE');
    INSERT INTO school_partner_attributions VALUES(1,1,1,'ACTIVE','2026-01-01Z',NULL),(2,2,2,'ACTIVE','2026-01-01Z',NULL);
    INSERT INTO subscription_rule_proposals
      (id,product,status,amount_minor,effective_at,activated_at,reason,created_by,updated_by)
      VALUES(1,'STUDENT_PLATFORM','ACTIVE',320000,'2027-01-01Z','2026-10-27Z','Fictional fixture',1,1),
      (2,'BRO_COMMISSION','SCHEDULED',15000,'2027-01-01Z','2026-10-27Z','Fictional fixture',1,1);
    INSERT INTO student_direct_live_reviews
      (id,school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
      VALUES(1,1,1,1,repeat('a',64),'fixture-merchant',true,1,now()+interval '1 hour','Fictional fixture');
    INSERT INTO student_direct_live_obligations
      (id,school_id,student_id,academic_term_id,rule_id,review_id,merchant_scope,created_by)
      VALUES(1,1,1,1,1,1,'fixture-merchant',1);
    INSERT INTO student_direct_live_attempts
      (id,obligation_id,reference,idempotency_key,state,created_by)
      VALUES(1,1,'SCV4_live_FICTIONAL01','fixture-key','RESERVED',1);
    INSERT INTO student_direct_live_events(id,attempt_id,kind) VALUES(1,1,'FIXTURE');
    INSERT INTO student_direct_live_release_requests
      (id,school_id,academic_term_id,rule_id,snapshot,facts_digest,evidence_digest,merchant_evidence_reference,
       merchant_evidence_hash,policy,no_split_confirmed,expires_at,created_by,reason)
      VALUES(1,1,1,1,'{}',repeat('b',64),repeat('c',64),'fixture-evidence',repeat('d',64),
       'NEW_ONLY_PRESERVE_LEGACY',true,now()+interval '1 hour',1,'Fictional fixture');
    INSERT INTO student_direct_live_release_decisions(id,request_id,action,actor_user_id,reason)
      VALUES(1,1,'APPROVED',1,'Fictional fixture');
    INSERT INTO student_direct_live_review_bindings(review_id,request_id,rule_version,release,environment)
      VALUES(1,1,1,'STUDENT_DIRECT_3200_V1','LIVE');
  `);
  for(const state of ["READY","UNKNOWN","PENDING"]){
    await check(`direct nonterminal transition to ${state} retains immutable identity`,async()=>{
      await pool.query("UPDATE student_direct_live_attempts SET state=$1 WHERE id=1",[state]);
      assert.equal((await pool.query("SELECT state FROM student_direct_live_attempts WHERE id=1")).rows[0].state,state);
    });
  }
  await check("direct attempts reject deletes and each frozen identity field independently",async()=>{
    await assert.rejects(pool.query("DELETE FROM student_direct_live_attempts WHERE id=1"),/cannot be deleted/);
    for(const assignment of ["obligation_id=2","reference='SCV4_live_CHANGED001'","idempotency_key='changed'",
      "created_by=2","created_at=created_at+interval '1 second'"]){
      await assert.rejects(pool.query(`UPDATE student_direct_live_attempts SET ${assignment} WHERE id=1`),/history is immutable/);
    }
  });
  await check("verified PAID transition is allowed and both terminal states are immutable",async()=>{
    for(const state of ["FAILED","PAID"]){
      await pool.query("BEGIN");
      try{
        await pool.query(`UPDATE student_direct_live_attempts SET state=$1,provider_transaction_id='12345',
          provider_reference='fixture-provider',provider_fee_minor=0,additional_fee_minor=0,
          verified_at='2027-01-20T09:00Z' WHERE id=1`,[state]);
        await pool.query("SAVEPOINT terminal");
        await assert.rejects(pool.query("UPDATE student_direct_live_attempts SET state='READY' WHERE id=1"),/immutable/);
        await pool.query("ROLLBACK TO SAVEPOINT terminal");
        await assert.rejects(pool.query("UPDATE student_direct_live_attempts SET provider_fee_minor=1 WHERE id=1"),/immutable/);
      }finally{await pool.query("ROLLBACK");}
    }
    await pool.query(`UPDATE student_direct_live_attempts SET state='PAID',provider_transaction_id='12345',
      provider_reference='fixture-provider',provider_fee_minor=0,additional_fee_minor=0,
      verified_at='2027-01-20T09:00Z' WHERE id=1`);
  });
  const earn=`INSERT INTO bro_term_commission_entitlements
    (id,school_id,student_id,academic_term_id,partner_profile_id,attribution_id,policy_id,
     direct_obligation_id,direct_attempt_id,amount_minor,earned_at,evidence,created_by)
    VALUES(1,$1,$2,$3,$4,$5,$6,$7,$8,15000,$9,
      '{"funding":"SEPARATE_PLATFORM_EXPENSE","studentCollectionMinor":320000,"collectionBroShareMinor":0}',1)`;
  const valid=[1,1,1,1,1,2,1,1,"2027-01-20T09:00Z"];
  await check("BRO scope rejects mismatched school/student/term/partner/attribution/payment/time",async()=>{
    for(const [index,value] of [[0,2],[1,2],[2,2],[3,2],[4,2],[5,1],[6,2],[7,2],[8,"2027-01-20T10:00Z"]]){
      const values=[...valid];values[index]=value;
      await assert.rejects(pool.query(earn,values),/earning scope or approval is invalid/);
    }
  });
  await check("BRO scope enforces approved rule status/rate/activation/effective window at Lagos term start",async()=>{
    const changes=["status='DRAFT'","status='RETIRED'","amount_minor=10000","activated_at=NULL",
      "effective_at='2027-01-17T23:00:01Z'","ends_at='2027-01-17T23:00:00Z'"];
    for(const change of changes){
      await pool.query("BEGIN");
      try{
        await pool.query(`UPDATE subscription_rule_proposals SET ${change} WHERE id=2`);
        await pool.query("SAVEPOINT earning");
        await assert.rejects(pool.query(earn,valid),/earning scope or approval is invalid/);
      }finally{await pool.query("ROLLBACK");}
    }
  });
  await check("BRO scope rejects non-PAID, wrong verification timestamp, missing transaction and term-school mismatch",async()=>{
    for(const change of [
      "UPDATE student_direct_live_attempts SET state='PENDING' WHERE id=1",
      "UPDATE student_direct_live_attempts SET verified_at='2027-01-20T10:00Z' WHERE id=1",
      "UPDATE student_direct_live_attempts SET state='PENDING',provider_transaction_id=NULL WHERE id=1",
      "UPDATE academic_terms SET school_id=2 WHERE id=1",
    ]){
      await pool.query("BEGIN");
      try{
        // Deliberately corrupt historical proof only inside this rolled-back fictional test.
        await pool.query("ALTER TABLE student_direct_live_attempts DISABLE TRIGGER student_direct_attempt_history");
        await pool.query(change);
        await assert.rejects(pool.query(earn,valid),/earning scope or approval is invalid/);
      }finally{await pool.query("ROLLBACK");}
    }
  });
  await check("eligible verified payment earns exactly 15000 separately, without collection split changes",async()=>{
    await pool.query(earn,valid);
    assert.deepEqual((await pool.query(`SELECT amount_minor,school_share_minor,bro_share_minor
      FROM student_direct_live_obligations WHERE id=1`)).rows[0],{amount_minor:320000,school_share_minor:0,bro_share_minor:0});
    assert.equal((await pool.query("SELECT amount_minor FROM bro_term_commission_entitlements WHERE id=1")).rows[0].amount_minor,15000);
  });
  for(const t of financialGuardTriggers.filter(t=>t.fn.endsWith("history"))){
    await check(`${t.name} blocks both UPDATE and DELETE of actual retained history`,async()=>{
      const column=t.table==="student_direct_live_review_bindings"?"review_id":"id";
      await assert.rejects(pool.query(`UPDATE public.${t.table} SET ${column}=${column}`),/append-only/);
      await assert.rejects(pool.query(`DELETE FROM public.${t.table}`),/append-only/);
    });
  }
  await check("repeat repair preserves populated direct/BRO and legacy rows byte-for-byte",async()=>{
    const tables=[...new Set(financialGuardTriggers.map(t=>t.table)),
      "student_subscription_payments","commission_ledger","staff_nfc_billing_rules"];
    const snapshot=async()=>{
      const rows=[];
      for(const t of tables)rows.push((await pool.query(`SELECT to_jsonb(t) row FROM public.${t} t ORDER BY to_jsonb(t)::text`)).rows);
      return rows;
    };
    const before=await snapshot();
    await pool.query(repair);await pool.query(repair);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await inspect()).ready,true);
    await assert.rejects(pool.query(earn,valid),e=>e.code==="23505");
  });
}
