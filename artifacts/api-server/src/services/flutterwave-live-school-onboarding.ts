import {createHash,createHmac} from "node:crypto";
import {z} from "zod";
import type {StudentSubscriptionSqlPool} from "../lib/student-subscription-billing";
import {encryptPayrollBankValue,decryptPayrollBankValue,getActivePayrollEncryptionKey} from "../lib/payroll-bank-encryption";
import {onboardingGate} from "../lib/flutterwave-live-onboarding-gate";
import {FlutterwaveLiveOnboardingProvider,LiveOnboardingBlocked,type LiveSchoolBank,type LiveSubaccountIdentity} from "../lib/flutterwave-live-onboarding-provider";
import {mutateLiveOnboarding} from "./flutterwave-live-onboarding-mutations";
type Db=Awaited<ReturnType<StudentSubscriptionSqlPool["connect"]>>;
type Row=Record<string,any>;
const sha=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const ad=(scope:string,id:number,field:string)=>scope==="SCHOOL"?`settlement:school:${id}:${field}`:`settlement:yemait-company:${field}`;
const requestAd=(scope:string,id:number)=>`live-school-onboarding:${scope}:${id}`;
const errorCode=(e:unknown)=>e instanceof LiveOnboardingBlocked?e.code:"LIVE_ONBOARDING_OPERATION_UNCONFIRMED";
const providerStatus=(e:unknown)=>e instanceof LiveOnboardingBlocked?e.providerHttpStatus:null;
const fail=(code:string):never=>{throw new LiveOnboardingBlocked(code);};
export const liveOnboardingReview=z.object({
  action:z.enum(["APPROVE_AND_CREATE","RECOVER","REJECT"]),note:z.string().trim().min(10).max(1000),
  ownershipConfirmed:z.boolean().optional(),distinctFromPlatformAccountConfirmed:z.boolean().optional(),
  merchantOwnershipConfirmed:z.boolean().optional(),kycConfirmed:z.boolean().optional(),
  feeBearer:z.literal("MERCHANT").optional(),
  ownershipEvidenceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  merchantEvidenceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  feeBearerEvidenceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  splitPolicyEvidenceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
async function actor(db:Db,id:number,schoolId:number|undefined,kind:"read"|"submit"|"owner"){
  const a=(await db.query(`SELECT
    EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL AND m.status='ACTIVE') AS owner,
    EXISTS(SELECT 1 FROM school_memberships m JOIN schools s ON s.id=m.school_id
      WHERE m.user_id=u.id AND m.school_id=$2 AND m.role='SCHOOL_ADMIN' AND m.status='ACTIVE' AND lower(s.status)='active') AS admin
    FROM app_users u WHERE u.id=$1 AND u.status='ACTIVE'`,[id,schoolId??null])).rows[0];
  if(!a||kind==="owner"&&!a.owner||kind==="submit"&&(a.owner||!a.admin)||kind==="read"&&!a.owner&&!a.admin)
    fail("LIVE_ONBOARDING_AUTHORITY_DENIED");
  return a;
}
async function source(db:Db,schoolId:number,lock=false,requireActive=true){
  const r=(await db.query(`SELECT p.*,s.name AS school_name,s.status AS school_status FROM settlement_payroll_profiles p
    JOIN schools s ON s.id=p.school_id WHERE p.scope='SCHOOL' AND p.school_id=$1${lock?" FOR SHARE OF p,s":""}`,[schoolId])).rows[0];
  if(!r||requireActive&&String(r.school_status).toLowerCase()!=="active")fail("ACTIVE_SCHOOL_SETTLEMENT_PROFILE_REQUIRED");
  return r as Row;
}
export function sourceHash(r:Row){
  return sha([r.id,r.school_id,r.school_name,r.school_status,r.business_name,r.business_registration_number,r.settlement_contact_email,r.settlement_contact_phone,
    r.bank_name_encrypted,r.bank_code_encrypted,r.account_name_encrypted,r.account_number_encrypted,r.encryption_key_version]);
}
function bankFromProfile(r:Row):LiveSchoolBank{
  const field=(name:string,column:string)=>decryptPayrollBankValue(r[column],r.encryption_key_version,ad("SCHOOL",r.school_id,name));
  const bank={bankName:field("bankName","bank_name_encrypted"),bankCode:field("bankCode","bank_code_encrypted"),
    accountName:field("accountName","account_name_encrypted"),accountNumber:field("accountNumber","account_number_encrypted"),
    businessName:String(r.business_name??"").trim(),businessEmail:String(r.settlement_contact_email??"").trim(),
    businessPhone:String(r.settlement_contact_phone??"").trim()};
  if(!/^\d{3,6}$/.test(bank.bankCode)||!/^\d{10}$/.test(bank.accountNumber)||bank.accountName.length<2
    ||bank.businessName.length<2||bank.businessName.length>150||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bank.businessEmail)
    ||!/^\+?\d{10,15}$/.test(bank.businessPhone))fail("SCHOOL_BANK_AND_BUSINESS_CONTACTS_REQUIRED");
  return bank;
}
async function distinctCompany(db:Db,bank:LiveSchoolBank){
  const r=(await db.query("SELECT * FROM settlement_payroll_profiles WHERE scope='YEMAIT_COMPANY' AND school_id IS NULL")).rows[0];
  if(!r)fail("PLATFORM_BANK_OWNERSHIP_REVIEW_REQUIRED");
  const code=decryptPayrollBankValue(r.bank_code_encrypted,r.encryption_key_version,ad("YEMAIT_COMPANY",0,"bankCode"));
  const number=decryptPayrollBankValue(r.account_number_encrypted,r.encryption_key_version,ad("YEMAIT_COMPANY",0,"accountNumber"));
  if(code===bank.bankCode&&number===bank.accountNumber)fail("SCHOOL_ACCOUNT_MUST_DIFFER_FROM_PLATFORM");
}
function snapshot(r:Row):LiveSchoolBank{
  return JSON.parse(decryptPayrollBankValue(r.snapshot_ciphertext,r.encryption_key_version,requestAd(r.merchant_scope,r.school_id)));
}
function view(r:Row,ready:boolean,current?:Row){
  const b=snapshot(r),stale=!!current&&sourceHash(current)!==r.snapshot_sha256;
  const expired=r.status==="BANK_VERIFIED"&&(!r.bank_verified_at||Date.now()-new Date(r.bank_verified_at).getTime()>=86400_000);
  return {id:r.id,schoolId:r.school_id,schoolName:r.school_name??b.businessName,status:r.status,
    bankName:b.bankName,accountName:b.accountName,maskedAccount:`••••${r.account_last4}`,
    businessName:b.businessName,businessEmail:b.businessEmail,businessPhone:b.businessPhone,
    providerSubaccountId:r.provider_subaccount_id??null,
    providerHttpStatus:r.provider_http_status??null,
    errorCode:stale?"SCHOOL_PROFILE_CHANGED":r.error_code??(expired?"FRESH_INDEPENDENT_LIVE_BANK_VERIFICATION_REQUIRED":null),
    errorMessage:stale?"School bank details changed. This frozen request cannot authorize new creation or checkout."
      :expired&&!r.error_code?"The LIVE bank verification is over 24 hours old. Ask the School Admin to submit the saved details again before Owner approval."
      :r.error_code?`${r.error_code.replaceAll("_"," ")}. Correct the prerequisite and use the permitted explicit action; never repeat an uncertain creation.`:null,
    canApprove:ready&&!stale&&r.status==="BANK_VERIFIED"&&!!r.bank_verified_at&&Date.now()-new Date(r.bank_verified_at).getTime()<86400_000,
    canRecover:ready&&["CREATING","CREATION_UNKNOWN"].includes(r.status),
    updatedAt:new Date(r.updated_at).toISOString(),checkoutEnabled:false};
}
async function getRow(db:Db,id:number,scope:string,lock=false):Promise<Row>{
  const r=(await db.query(`SELECT * FROM flutterwave_live_school_onboarding
    WHERE id=$1 AND merchant_scope=$2 AND environment='LIVE'${lock?" FOR UPDATE":""}`,[id,scope])).rows[0];
  if(!r)fail("LIVE_SCHOOL_ONBOARDING_NOT_FOUND");return r;
}
async function requiredGate(pool:StudentSubscriptionSqlPool,env:NodeJS.ProcessEnv){
  const gate=await onboardingGate(pool,env);
  if(gate.blockers.length)fail(gate.blockers.join(","));
  return gate;
}
export async function listLiveSchoolOnboarding(pool:StudentSubscriptionSqlPool,actorId:number,schoolId:number|undefined,env:NodeJS.ProcessEnv){
  const db=await pool.connect();
  try{
    await actor(db,actorId,schoolId,"read");
    const gate=await onboardingGate(pool,env);
    const exists=(await db.query("SELECT to_regclass('flutterwave_live_school_onboarding') AS present")).rows[0]?.present;
    if(!exists)return {ready:false,blockers:[...new Set([...gate.blockers,"LIVE_ONBOARDING_SCHEMA_APPROVAL_REQUIRED"])],items:[]};
    const rows=(await db.query(`SELECT o.*,s.name AS school_name FROM flutterwave_live_school_onboarding o JOIN schools s ON s.id=o.school_id
      WHERE o.environment='LIVE' AND o.merchant_scope=$1 AND($2::integer IS NULL OR o.school_id=$2)
      ORDER BY o.id DESC LIMIT 200`,[gate.merchantScope,schoolId??null])).rows;
    const items=[];
    for(const row of rows)items.push(view(row,!gate.blockers.length,await source(db,row.school_id,false,false)));
    return {ready:!gate.blockers.length,blockers:gate.blockers,items};
  }finally{db.release();}
}
export async function submitLiveSchoolOnboarding(pool:StudentSubscriptionSqlPool,actorId:number,schoolId:number,env:NodeJS.ProcessEnv,fetcher:typeof fetch=fetch){
  const db=await pool.connect();let row:Row,bank:LiveSchoolBank;
  try{
    await actor(db,actorId,schoolId,"submit");
    const gate=await requiredGate(pool,env);
    await db.query("BEGIN");await db.query("SET LOCAL lock_timeout='2s'");await db.query("SET LOCAL statement_timeout='3s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`live-school-onboarding:${gate.merchantScope}:${schoolId}`]);
    const p=await source(db,schoolId,true);bank=bankFromProfile(p);await distinctCompany(db,bank);
    const hash=sourceHash(p);
    const prior=(await db.query(`SELECT * FROM flutterwave_live_school_onboarding
      WHERE merchant_scope=$1 AND school_id=$2 AND status NOT IN('STALE','REJECTED') FOR UPDATE`,[gate.merchantScope,schoolId])).rows[0];
    if(prior?.creation_claimed_at){await db.query("COMMIT");return view(prior,true,p);}
    if(prior&&prior.snapshot_sha256!==hash)await mutateLiveOnboarding(db,{
      transaction:"caller",merchantScope:gate.merchantScope,id:prior.id,
      sql:`UPDATE flutterwave_live_school_onboarding
      SET status='STALE',error_code='SCHOOL_PROFILE_CHANGED',last_actor_id=$2,updated_at=now() WHERE id=$1 RETURNING *`,values:[prior.id,actorId]});
    if(prior?.snapshot_sha256===hash){
      row=prior;
      if(prior.status==="BANK_VERIFIED"&&Date.now()-new Date(prior.bank_verified_at).getTime()<86400_000){
        await db.query("COMMIT");return view(row,true,p);
      }
    }else{
      const encrypted=encryptPayrollBankValue(JSON.stringify(bank),requestAd(gate.merchantScope,schoolId));
      const fingerprint=createHmac("sha256",getActivePayrollEncryptionKey().key).update(`${gate.merchantScope}:${bank.bankCode}:${bank.accountNumber}`).digest("hex");
      row=(await mutateLiveOnboarding(db,{transaction:"caller",merchantScope:gate.merchantScope,sql:`INSERT INTO flutterwave_live_school_onboarding
        (merchant_scope,school_id,profile_id,snapshot_sha256,snapshot_ciphertext,encryption_key_version,bank_fingerprint,account_last4,submitted_by,last_actor_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      values:[gate.merchantScope,schoolId,p.id,hash,encrypted.ciphertext,encrypted.keyVersion,fingerprint,bank.accountNumber.slice(-4),actorId]}))!;
    }
    await db.query("COMMIT");
    try{
      await new FlutterwaveLiveOnboardingProvider(env,fetcher).resolve(bank);
      row=await mutateLiveOnboarding(db,{transaction:"own",merchantScope:row.merchant_scope,id:row.id,
        sql:`UPDATE flutterwave_live_school_onboarding SET status='BANK_VERIFIED',bank_verified_at=now(),
        error_code=NULL,provider_http_status=NULL,last_actor_id=$2,updated_at=now() WHERE id=$1 AND status IN('SUBMITTED','ACTION_REQUIRED','BANK_VERIFIED') RETURNING *`,
        values:[row.id,actorId]})??await getRow(db,row.id,row.merchant_scope);
    }catch(e){
      row=await mutateLiveOnboarding(db,{transaction:"own",merchantScope:row.merchant_scope,id:row.id,
        sql:`UPDATE flutterwave_live_school_onboarding SET
        status=CASE WHEN $2='LIVE_BANK_ACCOUNT_HOLDER_MISMATCH' THEN 'ACTION_REQUIRED' ELSE status END,error_code=$2,
        last_actor_id=$3,provider_http_status=$4,updated_at=now() WHERE id=$1 AND status IN('SUBMITTED','ACTION_REQUIRED','BANK_VERIFIED') RETURNING *`,
        values:[row.id,errorCode(e),actorId,providerStatus(e)]})??await getRow(db,row.id,row.merchant_scope);
    }
    return view(row,true,await source(db,schoolId));
  }catch(e){await db.query("ROLLBACK").catch(()=>undefined);throw e;}finally{db.release();}
}
async function assertNotBoundElsewhere(db:Db,row:Row,identity:LiveSubaccountIdentity){
  // Preserve pre-existing LIVE school authority even when it predates this queue.
  const exists=(await db.query("SELECT to_regclass('flutterwave_live_authority_reviews') AS present")).rows[0]?.present;
  if(exists&&(await db.query(`SELECT id FROM flutterwave_live_authority_reviews
    WHERE merchant_scope=$1 AND school_subaccount_id=$2 AND school_id<>$3 LIMIT 1`,
  [row.merchant_scope,identity.subaccountId,row.school_id])).rows.length)
    fail("LIVE_SUBACCOUNT_BOUND_TO_ANOTHER_SCHOOL");
}
async function finish(db:Db,row:Row,identity:LiveSubaccountIdentity,actorId:number){
  await assertNotBoundElsewhere(db,row,identity);
  const current=await source(db,row.school_id);
  const changed=sourceHash(current)!==row.snapshot_sha256;
  const updated=await mutateLiveOnboarding(db,{transaction:"own",merchantScope:row.merchant_scope,id:row.id,
    sql:`UPDATE flutterwave_live_school_onboarding SET provider_id=$2,provider_subaccount_id=$3,
    status=$4,error_code=$5,last_actor_id=$6,provider_http_status=NULL,updated_at=now() WHERE id=$1 AND status IN('CREATING','CREATION_UNKNOWN') RETURNING *`,
    values:[row.id,identity.providerId,identity.subaccountId,changed?"CREATION_UNKNOWN":"LIVE_VERIFIED",changed?"SCHOOL_PROFILE_CHANGED_AFTER_CREATION":null,actorId]})??await getRow(db,row.id,row.merchant_scope);
  return view(updated,true,current);
}
export async function reviewLiveSchoolOnboarding(pool:StudentSubscriptionSqlPool,actorId:number,id:number,
  input:z.infer<typeof liveOnboardingReview>,env:NodeJS.ProcessEnv,fetcher:typeof fetch=fetch){
  const db=await pool.connect();
  try{
    await actor(db,actorId,undefined,"owner");
    const gate=await requiredGate(pool,env),provider=new FlutterwaveLiveOnboardingProvider(env,fetcher);
    let row=await getRow(db,id,gate.merchantScope),bank=snapshot(row);
    if(input.action==="REJECT"){
      const r=await mutateLiveOnboarding(db,{transaction:"own",merchantScope:gate.merchantScope,id,
        sql:`UPDATE flutterwave_live_school_onboarding SET status='REJECTED',
        error_code='OWNER_REJECTED',last_actor_id=$2,updated_at=now()
        WHERE id=$1 AND creation_claimed_at IS NULL AND status IN('SUBMITTED','BANK_VERIFIED','ACTION_REQUIRED') RETURNING *`,values:[id,actorId]});
      if(!r)throw new LiveOnboardingBlocked("CREATION_ALREADY_CLAIMED_RECONCILE_ONLY");return view(r,true);
    }
    if(input.action==="RECOVER"){
      if(!row.creation_claimed_at||!["CREATING","CREATION_UNKNOWN"].includes(row.status))fail("LIVE_RECOVERY_NOT_REQUIRED");
      if(row.status==="CREATING"&&Date.now()-new Date(row.creation_claimed_at).getTime()<120_000)fail("LIVE_CREATION_IN_PROGRESS");
      try{
        const providerId=row.provider_id?Number(row.provider_id):await provider.find(bank);
        if(providerId===null)throw new LiveOnboardingBlocked("LIVE_RECOVERY_NO_MATCH_NO_NEW_CREATION");
        return await finish(db,row,await provider.verify(providerId,bank),actorId);
      }catch(e){
        const r=await mutateLiveOnboarding(db,{transaction:"own",merchantScope:gate.merchantScope,id,
          sql:`UPDATE flutterwave_live_school_onboarding SET status='CREATION_UNKNOWN',
          error_code=$2,last_actor_id=$3,provider_http_status=$4,updated_at=now() WHERE id=$1 AND status IN('CREATING','CREATION_UNKNOWN') RETURNING *`,
          values:[id,errorCode(e),actorId,providerStatus(e)]})??await getRow(db,id,gate.merchantScope);
        return view(r,true);
      }
    }
    if(row.creation_claimed_at)return view(row,true);
    if(!input.ownershipConfirmed||!input.distinctFromPlatformAccountConfirmed||!input.merchantOwnershipConfirmed||!input.kycConfirmed
      ||input.feeBearer!=="MERCHANT"||!input.ownershipEvidenceSha256||!input.merchantEvidenceSha256
      ||!input.feeBearerEvidenceSha256||!input.splitPolicyEvidenceSha256)fail("OWNER_OWNERSHIP_KYC_FEE_AND_SPLIT_EVIDENCE_REQUIRED");
    const p=await source(db,row.school_id);
    if(sourceHash(p)!==row.snapshot_sha256)fail("SCHOOL_PROFILE_CHANGED");
    await distinctCompany(db,bank);
    if(row.status!=="BANK_VERIFIED"||!row.bank_verified_at||Date.now()-new Date(row.bank_verified_at).getTime()>86400_000)
      fail("FRESH_INDEPENDENT_LIVE_BANK_VERIFICATION_REQUIRED");
    // Read-only preflight occurs before claiming a POST. Failure here is safely
    // retryable after fixing permission/configuration; no creation was attempted.
    let existing:number|null;
    try{
      await provider.resolve(bank);existing=await provider.find(bank);
      if(existing!==null)await assertNotBoundElsewhere(db,row,await provider.verify(existing,bank));
    }
    catch(e){
      await mutateLiveOnboarding(db,{transaction:"own",merchantScope:gate.merchantScope,id,
        sql:`UPDATE flutterwave_live_school_onboarding SET error_code=$2,last_actor_id=$3,provider_http_status=$4,updated_at=now()
        WHERE id=$1 AND status='BANK_VERIFIED' AND creation_claimed_at IS NULL RETURNING *`,values:[id,errorCode(e),actorId,providerStatus(e)]});
      throw e;
    }
    await db.query("BEGIN");await db.query("SET LOCAL lock_timeout='2s'");await db.query("SET LOCAL statement_timeout='3s'");
    row=await getRow(db,id,gate.merchantScope,true);
    if(row.creation_claimed_at){await db.query("COMMIT");return view(row,true);}
    await actor(db,actorId,undefined,"owner");
    const current=await source(db,row.school_id,true);
    if(sourceHash(current)!==row.snapshot_sha256||row.status!=="BANK_VERIFIED")fail("SCHOOL_PROFILE_CHANGED");
    await distinctCompany(db,bank);
    await requiredGate(pool,env);
    row=(await mutateLiveOnboarding(db,{transaction:"caller",merchantScope:gate.merchantScope,id,
      sql:`UPDATE flutterwave_live_school_onboarding SET status='CREATING',creation_claimed_at=now(),
      approved_by=$2,approval_evidence=$3::jsonb,error_code=NULL,provider_http_status=NULL,last_actor_id=$2,updated_at=now() WHERE id=$1 RETURNING *`,
      values:[id,actorId,JSON.stringify(input)]}))!;
    await db.query("COMMIT"); // If this acknowledgement is lost, NEVER send POST.
    try{
      const providerId=existing??await provider.create(bank);
      row=await mutateLiveOnboarding(db,{transaction:"own",merchantScope:gate.merchantScope,id,
        sql:`UPDATE flutterwave_live_school_onboarding SET provider_id=$2,last_actor_id=$3,updated_at=now()
        WHERE id=$1 AND status='CREATING' RETURNING *`,values:[id,providerId,actorId]})??await getRow(db,id,gate.merchantScope);
      return await finish(db,row,await provider.verify(providerId,bank),actorId);
    }catch(e){
      row=await mutateLiveOnboarding(db,{transaction:"own",merchantScope:gate.merchantScope,id,
        sql:`UPDATE flutterwave_live_school_onboarding SET status='CREATION_UNKNOWN',error_code=$2,
        last_actor_id=$3,provider_http_status=$4,updated_at=now() WHERE id=$1 AND status IN('CREATING','CREATION_UNKNOWN') RETURNING *`,
        values:[id,errorCode(e),actorId,providerStatus(e)]})??await getRow(db,id,gate.merchantScope);
      return view(row,true);
    }
  }catch(e){await db.query("ROLLBACK").catch(()=>undefined);throw e;}finally{db.release();}
}
