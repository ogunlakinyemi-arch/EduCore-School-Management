import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { getUserContext, requireAuthentication } from "../middlewares/auth";
import {accrueBroCommission,broCommissionSnapshot,broStorageReady,BroCommissionBlocked,BRO_TERM_RATE_MINOR} from "../services/bro-commission-policy";

const router=Router();
router.use(requireAuthentication());
type Sql = { query:(text:string,values?:unknown[])=>Promise<{rows:any[]}> };
class RuleError extends Error { constructor(public status:number,message:string){super(message);} }
const owner=(req:Request)=>{
  const c=getUserContext(req);
  if(c.user.status!=="ACTIVE" || !c.roles.some(r=>r.role==="PLATFORM_OWNER" && r.schoolId===null && r.status==="ACTIVE"))
    throw new RuleError(403,"Active global Platform Owner access required.");
  return c;
};
const id=(v:unknown)=>{
  if(!/^[1-9]\d*$/.test(String(v)) || !Number.isSafeInteger(Number(v)))throw new RuleError(400,"Invalid identifier.");
  return Number(v);
};
const date=(v:string)=>{
  const d=new Date(v);
  if(!Number.isFinite(d.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(v))throw new RuleError(400,"Use a date and time with a time zone.");
  return d;
};
const input=z.object({
  product:z.enum(["STUDENT_PLATFORM","TEACHER_STAFF_PLATFORM","BRO_COMMISSION"]),
  amountMinor:z.number().int().positive().max(100_000_000),
  currency:z.literal("NGN"),
  billingPeriod:z.literal("ACADEMIC_TERM"),
  schoolShareMinor:z.literal(0),
  effectiveAt:z.string().min(1), endsAt:z.string().nullable().optional(),
  reason:z.string().trim().min(3).max(500),
}).strict();
const edition=input.extend({version:z.number().int().positive()});
const activation=z.object({version:z.number().int().positive(),previewDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const bankInput=z.object({bankName:z.string().trim().min(2).max(100),
  bankStatementReference:z.string().trim().min(6).max(120),
  creditDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verifiedAmountMinor:z.number().int().positive().max(100_000_000),
  independentlyChecked:z.literal(true)}).strict();
const assistanceInput=z.object({schoolId:z.number().int().positive(),studentId:z.number().int().positive(),
  termId:z.number().int().positive(),amountMinor:z.literal(320_000),
  requestNote:z.string().trim().max(500)}).strict();
const parse=<T>(schema:z.ZodType<T>,body:unknown):T=>{
  const result=schema.safeParse(body);
  if(!result.success)throw new RuleError(400,"Invalid rule, amount, date, reason or verification details.");
  return result.data;
};
const validate=(v:z.infer<typeof input>)=>{
  const start=date(v.effectiveAt),end=v.endsAt?date(v.endsAt):null;
  if(end && end<=start)throw new RuleError(400,"End must follow the effective date.");
  if(v.product==="TEACHER_STAFF_PLATFORM" && v.amountMinor!==200_000)
    throw new RuleError(409,"Staff price requires a separately reviewed transition; the current platform-only policy is ₦2,000.");
  return {start,end};
};
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const view=(r:any)=>({id:Number(r.id),product:r.product,status:r.status,amountMinor:r.amount_minor,
  currency:r.currency,billingPeriod:r.billing_period,schoolShareMinor:r.school_share_minor,
  effectiveAt:r.effective_at,endsAt:r.ends_at,reason:r.reason,version:r.version,
  nativeRuleId:r.native_rule_id});
const stamp=(r:any)=>({product:r.product,amountMinor:r.amount_minor,effectiveAt:new Date(r.effective_at).toISOString(),
  endsAt:r.ends_at?new Date(r.ends_at).toISOString():null,reason:r.reason,version:r.version,status:r.status});
async function audit(c:Sql,req:Request,action:string,before:unknown,after:unknown,recordId:number,reason:string){
  const u=owner(req).user;
  await c.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,metadata)
    VALUES($1,'PLATFORM_OWNER',$2,$3,$4,'Subscription & Payment Rules',$5,$6,$7::jsonb)`,
    [[u.firstName,u.lastName].filter(Boolean).join(" ")||u.email,u.id,u.clerkUserId,action,recordId,
      `SUBSCRIPTION_RULE_${action}`,JSON.stringify({before,after,reason})]);
}
const wrap=(fn:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response)=>{
  res.setHeader("Cache-Control","no-store");
  try{owner(req);await fn(req,res);}
  catch(error){
    if(error instanceof BroCommissionBlocked){res.status(409).json({error:error.message});return;}
    if(error instanceof RuleError){res.status(error.status).json({error:error.message});return;}
    const code=typeof error==="object" && error!==null && "code" in error?String(error.code):"";
    if(code==="23505" || code==="23P01"){res.status(409).json({error:"Conflicting rule or receipt reference. No change was applied."});return;}
    req.log?.error({errorName:error instanceof Error?error.name:"Unknown",code},"Subscription rule management unavailable");
    res.status(503).json({error:"Rules could not be safely read or saved. No payment was initiated."});
  }
};
async function transaction<T>(fn:(c:Sql)=>Promise<T>){
  const c=await pool.connect();
  try{await c.query("BEGIN");await c.query("SET LOCAL lock_timeout = '2s'");
    await c.query("SELECT pg_advisory_xact_lock(310031,1)");
    const result=await fn(c);
    await c.query("COMMIT");return result;
  }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}
  finally{c.release();}
}
async function currentStaff(c:Sql){
  const r=await c.query(`SELECT id,version,effective_at AS "effectiveAt",
    to_jsonb(staff_nfc_billing_rules)->>'ends_at' AS "endsAt"
    FROM staff_nfc_billing_rules WHERE product='TEACHER_STAFF_NFC_EID'
    ORDER BY effective_at DESC,version DESC LIMIT 1`);
  return r.rows[0]??null;
}
async function preview(c:Sql,r:any){
  const value=view(r),now=Date.now();
  const native=r.product==="TEACHER_STAFF_PLATFORM"?await currentStaff(c):null;
  let blocker:string|null=null;
  if(r.product==="BRO_COMMISSION"){
    if(Number(r.amount_minor)!==BRO_TERM_RATE_MINOR)blocker="Prospective BRO policy requires ₦150 per eligible student per academic term.";
    else if(!await broStorageReady(c))blocker="BRO storage review and recovery safety clearance are required before installation and activation.";
  }else if(r.product!=="TEACHER_STAFF_PLATFORM")
    blocker=r.product==="STUDENT_PLATFORM"
      ?"Student ₦3,200 adoption and verified checkout are not approved; a draft cannot be activated."
      :"BRO entitlement activation awaits its separate verified, idempotent ledger policy.";
  if(r.status!=="DRAFT")blocker="Only drafts can be activated.";
  if(new Date(r.effective_at).getTime()<=now)blocker="Choose a future effective date and time.";
  if(native && new Date(native.effectiveAt)>=new Date(r.effective_at))
    blocker="Effective period overlaps or precedes an existing staff billing version.";
  const other=await c.query(`SELECT id FROM subscription_rule_proposals
    WHERE product=$1 AND id<>$2 AND status IN ('ACTIVE','SCHEDULED')
      AND effective_at<COALESCE($3::timestamptz,'infinity'::timestamptz)
      AND effective_at >= $4::timestamptz LIMIT 1`,
    [r.product,r.id,r.ends_at,r.effective_at]);
  if(other.rows.length)blocker="An effective period overlaps an activated rule.";
  // Source versions and values are rechecked under an advisory transaction lock on activation.
  return {rule:value,activationAvailable:!blocker,blocker,
    previewDigest:digest({rule:stamp(r),native:native?.id??null,nativeVersion:native?.version??null,
      nativeEffectiveAt:native?.effectiveAt?new Date(native.effectiveAt).toISOString():null,
      nativeEndsAt:native?.endsAt??null,blocker})};
}
router.get("/platform/subscription-payment-rules",wrap(async(req,res)=>{
  const [staff,bro,drafts,auditRows,assistance,broCommission]=await Promise.all([
    pool.query(`SELECT id,version,price_minor AS "priceMinor",school_share_minor AS "schoolShareMinor",
      partner_commission_minor AS "partnerCommissionMinor",effective_at AS "effectiveAt",
      to_jsonb(r)->>'ends_at' AS "endsAt",status FROM staff_nfc_billing_rules r ORDER BY version DESC LIMIT 100`),
    pool.query(`SELECT id,name,status,term,partner_amount::float AS "partnerAmount",
      school_amount::float AS "schoolAmount",effective_at AS "effectiveDate"
      FROM commission_rules ORDER BY effective_at DESC LIMIT 100`),
    pool.query(`SELECT * FROM subscription_rule_proposals ORDER BY created_at DESC LIMIT 100`),
    pool.query(`SELECT id,"user",action,timestamp,metadata FROM audit_logs
      WHERE module='Subscription & Payment Rules' ORDER BY timestamp DESC,id DESC LIMIT 100`),
    pool.query(`SELECT id,school_id AS "schoolId",student_id AS "studentId",
      academic_term_id AS "termId",amount_minor AS "amountMinor",status,request_note AS "requestNote",
      bank_name AS "bankName",bank_statement_reference AS "bankStatementReference",
      bank_credit_date::text AS "bankCreditDate",verified_amount_minor AS "verifiedAmountMinor",
      verified_at AS "verifiedAt",created_at AS "createdAt"
      FROM subscription_payment_assistance_requests ORDER BY created_at DESC LIMIT 100`),
    broCommissionSnapshot(pool),
  ]);
  res.json({intendedStudentFeeMinor:320000,intendedStaffFeeMinor:200000,
    studentCheckoutAvailable:false,providerInitiationAvailable:false,
    staffRules:staff.rows.map(r=>({...r,status:r.endsAt && new Date(r.endsAt)<=new Date()?"RETIRED":
      new Date(r.effectiveAt)>new Date()?"SCHEDULED":"ACTIVE"})),
    broRules:bro.rows,proposals:drafts.rows.map(r=>({...view(r),status:r.status==="RETIRED"?"RETIRED":
      r.status==="DRAFT"?"DRAFT":r.ends_at && new Date(r.ends_at)<=new Date()?"RETIRED":
      new Date(r.effective_at)>new Date()?"SCHEDULED":"ACTIVE"})),audit:auditRows.rows,
    assistance:assistance.rows,broCommission});
}));
router.post("/platform/subscription-payment-rules",wrap(async(req,res)=>{
  const v=parse(input,req.body),{start,end}=validate(v),actor=owner(req).user.id;
  if(start.getTime()<=Date.now())throw new RuleError(400,"Choose a future effective date.");
  const saved=await transaction(async c=>{
    const r=await c.query(`INSERT INTO subscription_rule_proposals
      (product,amount_minor,currency,billing_period,school_share_minor,effective_at,ends_at,reason,created_by,updated_by)
      VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,$8) RETURNING *`,
      [v.product,v.amountMinor,v.currency,v.billingPeriod,start,end,v.reason,actor]);
    await audit(c,req,"DRAFT_CREATED",null,view(r.rows[0]),Number(r.rows[0].id),v.reason);
    return view(r.rows[0]);
  });
  res.status(201).json(saved);
}));
router.patch("/platform/subscription-payment-rules/:id",wrap(async(req,res)=>{
  const ruleId=id(req.params.id),v=parse(edition,req.body),{start,end}=validate(v),actor=owner(req).user.id;
  if(start.getTime()<=Date.now())throw new RuleError(400,"Choose a future effective date.");
  const updated=await transaction(async c=>{
    const previous=(await c.query("SELECT * FROM subscription_rule_proposals WHERE id=$1 FOR UPDATE",[ruleId])).rows[0];
    if(!previous)throw new RuleError(404,"Draft not found.");
    if(previous.status!=="DRAFT" || previous.version!==v.version)throw new RuleError(409,"Draft changed or was already activated; refresh before editing.");
    const r=(await c.query(`UPDATE subscription_rule_proposals SET
      product=$2,amount_minor=$3,currency=$4,billing_period=$5,school_share_minor=0,
      effective_at=$6,ends_at=$7,reason=$8,updated_by=$9,updated_at=now(),version=version+1
      WHERE id=$1 RETURNING *`,
      [ruleId,v.product,v.amountMinor,v.currency,v.billingPeriod,start,end,v.reason,actor])).rows[0];
    await audit(c,req,"DRAFT_EDITED",view(previous),view(r),ruleId,v.reason);
    return view(r);
  });
  res.json(updated);
}));
router.post("/platform/subscription-payment-rules/:id/preview",wrap(async(req,res)=>{
  const ruleId=id(req.params.id);
  const c=await pool.connect();
  try{
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const r=(await c.query("SELECT * FROM subscription_rule_proposals WHERE id=$1",[ruleId])).rows[0];
    if(!r)throw new RuleError(404,"Rule not found.");
    res.json(await preview(c,r));
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
}));
router.post("/platform/subscription-payment-rules/:id/activate",wrap(async(req,res)=>{
  const ruleId=id(req.params.id),confirm=parse(activation,req.body);
  const result=await transaction(async c=>{
    const before=(await c.query("SELECT * FROM subscription_rule_proposals WHERE id=$1 FOR UPDATE",[ruleId])).rows[0];
    if(!before)throw new RuleError(404,"Rule not found.");
    const p=await preview(c,before);
    if(!p.activationAvailable || before.version!==confirm.version || p.previewDigest!==confirm.previewDigest)
      throw new RuleError(409,p.blocker??"Preview changed. Review the latest rule before activation.");
    if(before.product==="BRO_COMMISSION"){
      const updated=(await c.query(`UPDATE subscription_rule_proposals SET status='SCHEDULED',
        activated_at=now(),updated_at=now(),updated_by=$2,version=version+1 WHERE id=$1 RETURNING *`,
        [ruleId,owner(req).user.id])).rows[0];
      await audit(c,req,"ACTIVATED",view(before),{...view(updated),funding:"SEPARATE_PLATFORM_EXPENSE",
        collectionAmountMinor:320000,collectionBroShareMinor:0},ruleId,before.reason);
      return view(updated);
    }
    if(before.product!=="TEACHER_STAFF_PLATFORM" || Number(before.amount_minor)!==200000 ||
       Number(before.school_share_minor)!==0)throw new RuleError(409,"Platform-only staff policy is required.");
    const native=await currentStaff(c);
    const nextVersion=Number(native?.version??0)+1;
    if(native && new Date(native.effectiveAt)<new Date(before.effective_at)){
      await c.query(`UPDATE staff_nfc_billing_rules SET ends_at=$2
        WHERE id=$1 AND (ends_at IS NULL OR ends_at>$2)`,[native.id,before.effective_at]);
      const prior=(await c.query(`UPDATE subscription_rule_proposals SET ends_at=$2,updated_at=now()
        WHERE native_rule_id=$1 AND status IN ('ACTIVE','SCHEDULED')
          AND (ends_at IS NULL OR ends_at>$2) RETURNING *`,[native.id,before.effective_at])).rows[0];
      if(prior)await audit(c,req,"EFFECTIVE_PERIOD_SUPERSEDED",
        {...view(prior),endsAt:native.endsAt},view(prior),Number(prior.id),before.reason);
    }
    const added=(await c.query(`INSERT INTO staff_nfc_billing_rules
      (version,product,billing_frequency,price_minor,school_share_minor,
       platform_share_minor,partner_commission_minor,no_partner_platform_share_minor,
       currency,effective_at,ends_at,created_by)
       VALUES($1,'TEACHER_STAFF_NFC_EID','ACADEMIC_TERM',200000,0,200000,0,200000,'NGN',$2,$3,$4)
       RETURNING id`,
      [nextVersion,before.effective_at,before.ends_at,owner(req).user.id])).rows[0];
    const updated=(await c.query(`UPDATE subscription_rule_proposals SET status='SCHEDULED',
      native_rule_id=$2,activated_at=now(),updated_at=now(),updated_by=$3,version=version+1
      WHERE id=$1 RETURNING *`,[ruleId,added.id,owner(req).user.id])).rows[0];
    await audit(c,req,"ACTIVATED",view(before),{...view(updated),nativeVersion:nextVersion},ruleId,before.reason);
    return view(updated);
  });
  res.json(result);
}));
router.post("/platform/subscription-payment-rules/:id/retire",wrap(async(req,res)=>{
  const ruleId=id(req.params.id),reason=z.string().trim().min(3).max(500).safeParse(req.body?.reason);
  if(!reason.success)throw new RuleError(400,"A retirement reason is required.");
  const result=await transaction(async c=>{
    const previous=(await c.query("SELECT * FROM subscription_rule_proposals WHERE id=$1 FOR UPDATE",[ruleId])).rows[0];
    if(!previous)throw new RuleError(404,"Rule not found.");
    if(!["ACTIVE","SCHEDULED"].includes(previous.status))throw new RuleError(409,"Only activated rules can be retired.");
    const latest=await currentStaff(c);
    if(previous.product!=="TEACHER_STAFF_PLATFORM" || Number(latest?.id)!==Number(previous.native_rule_id))
      throw new RuleError(409,"Only the newest native staff rule may be retired here.");
    // Do not reactivate an older version. An Owner must approve a replacement
    // before staff subscriptions can be generated again.
    const cutoff=new Date(Math.max(Date.now(),new Date(previous.effective_at).getTime())).toISOString();
    if(previous.product==="TEACHER_STAFF_PLATFORM")
      await c.query("UPDATE staff_nfc_billing_rules SET ends_at=$2 WHERE id=$1",[previous.native_rule_id,cutoff]);
    const updated=(await c.query(`UPDATE subscription_rule_proposals SET status='RETIRED',
      ends_at=GREATEST(now(),effective_at + interval '1 microsecond'),
      retired_at=now(),updated_at=now(),updated_by=$2,version=version+1 WHERE id=$1 RETURNING *`,
      [ruleId,owner(req).user.id])).rows[0];
    await audit(c,req,"RETIRED",view(previous),view(updated),ruleId,reason.data);
    return view(updated);
  });
  res.json(result);
}));
router.post("/platform/bro-commissions/accruals",wrap(async(req,res)=>{
  const scope=parse(z.object({schoolId:z.number().int().positive(),studentId:z.number().int().positive(),
    termId:z.number().int().positive()}).strict(),req.body);
  const actor=owner(req).user;
  res.json(await accrueBroCommission(pool,scope,{id:actor.id,email:actor.email,clerkUserId:actor.clerkUserId!}));
}));
router.post("/platform/subscription-payment-assistance",wrap(async(req,res)=>{
  const v=parse(assistanceInput,req.body);
  const saved=await transaction(async c=>{
    const eligible=await c.query(`SELECT 1 FROM students s JOIN academic_terms t ON
      t.id=$3 AND t.school_id=$1 WHERE s.id=$2 AND s.school_id=$1`,
      [v.schoolId,v.studentId,v.termId]);
    if(eligible.rows.length!==1)throw new RuleError(404,"Student and term do not belong to this school.");
    const r=(await c.query(`INSERT INTO subscription_payment_assistance_requests
      (school_id,student_id,academic_term_id,amount_minor,request_note,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [v.schoolId,v.studentId,v.termId,v.amountMinor,v.requestNote,owner(req).user.id])).rows[0];
    await audit(c,req,"ASSISTANCE_REQUESTED",null,
      {schoolId:v.schoolId,studentId:v.studentId,termId:v.termId,amountMinor:v.amountMinor},Number(r.id),v.requestNote||"Owner request");
    return {id:Number(r.id),status:r.status};
  });
  res.status(201).json(saved);
}));
router.post("/platform/subscription-payment-assistance/:id/verify-bank",wrap(async(req,res)=>{
  const requestId=id(req.params.id),v=parse(bankInput,req.body);
  // A receipt upload or request alone never verifies the bank. This records an
  // accountable Owner assertion about an independently examined bank credit.
  const creditInstant=new Date(`${v.creditDate}T00:00:00Z`);
  if(!Number.isFinite(creditInstant.getTime()) || creditInstant.toISOString().slice(0,10)!==v.creditDate ||
     v.creditDate>new Date().toISOString().slice(0,10))
    throw new RuleError(400,"Invalid or future bank credit date.");
  const saved=await transaction(async c=>{
    const prior=(await c.query("SELECT * FROM subscription_payment_assistance_requests WHERE id=$1 FOR UPDATE",[requestId])).rows[0];
    if(!prior)throw new RuleError(404,"Assistance request not found.");
    if(prior.status!=="REQUESTED" || Number(prior.amount_minor)!==v.verifiedAmountMinor)
      throw new RuleError(409,"Request changed, already verified, or credit amount does not match.");
    const r=(await c.query(`UPDATE subscription_payment_assistance_requests SET
      status='BANK_VERIFIED',bank_name=$2,bank_statement_reference=$3,
      bank_credit_date=$4,verified_amount_minor=$5,verified_by=$6,verified_at=now()
      WHERE id=$1 RETURNING *`,
      [requestId,v.bankName,v.bankStatementReference,v.creditDate,v.verifiedAmountMinor,owner(req).user.id])).rows[0];
    await audit(c,req,"BANK_CREDIT_VERIFIED",
      {status:prior.status,amountMinor:prior.amount_minor},
      {status:r.status,amountMinor:r.amount_minor,bankName:v.bankName,
        bankStatementReference:v.bankStatementReference,bankCreditDate:v.creditDate},
      requestId,"Owner independently checked matching bank credit");
    return {id:Number(r.id),status:r.status,providerInitiationAvailable:false};
  });
  res.json(saved);
}));
export default router;
