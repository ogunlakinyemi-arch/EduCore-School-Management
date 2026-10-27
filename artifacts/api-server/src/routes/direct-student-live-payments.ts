import { Router,type Request,type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuthentication,getUserContext } from "../middlewares/auth";
import { directLiveConfiguration } from "../lib/flutterwave-direct-live-config";
import {readStudentRollout} from "../services/student-platform-rollout";
import { authenticateDirectStudentWebhook,directStudentReadiness,startDirectStudentPayment,
  verifyDirectStudentPayment,DirectPaymentBlocked } from "../services/direct-student-live-payments";
const router=Router();
const positive=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const scope=z.object({studentId:positive,termId:positive}).strict();
const owner=(req:Request)=>{const c=getUserContext(req);return c.user.status==="ACTIVE"&&
  c.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.schoolId===null&&r.status==="ACTIVE");};
const schoolAdmin=(req:Request,id:number)=>{const c=getUserContext(req);return c.user.status==="ACTIVE"&&
  !c.roles.some(r=>r.role==="PLATFORM_OWNER")&&c.roles.some(r=>r.role==="SCHOOL_ADMIN"&&r.schoolId===id&&r.status==="ACTIVE");};
const safeError=(res:Response,e:unknown)=>{
  res.status(e instanceof DirectPaymentBlocked?e.statusCode:503)
    .json({error:e instanceof DirectPaymentBlocked?e.code:"DIRECT_LIVE_PAYMENT_UNAVAILABLE"});
};
router.get("/schools/:schoolId/platform-subscriptions/live-readiness",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const sid=positive.safeParse(req.params.schoolId),s=scope.safeParse(req.query);
  if(!sid.success||!s.success){res.status(400).json({error:"Invalid scope."});return;}
  if(!owner(req)&&!schoolAdmin(req,sid.data)){res.status(403).json({error:"School Admin or global Owner required."});return;}
  try{
    const r=await directStudentReadiness(pool,{schoolId:sid.data,...s.data});
    res.json({ready:r.ready,blockers:r.blockers,amountMinor:320000,schoolShareMinor:0,broShareMinor:0,
      currency:"NGN",mode:r.ready?"LIVE":process.env.NODE_ENV==="development"&&!process.env.REPLIT_DEPLOYMENT?"TEST_ONLY":"BLOCKED",
      providerValidated:false});
  }catch(e){safeError(res,e);}
});
router.post("/schools/:schoolId/platform-subscriptions/checkout",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const sid=positive.safeParse(req.params.schoolId),s=scope.safeParse(req.body);
  if(!sid.success||!s.success){res.status(400).json({error:"Invalid scope."});return;}
  if(!schoolAdmin(req,sid.data)){res.status(403).json({error:"School Admin required; Owner uses independently verified assistance."});return;}
  try{
    const c=getUserContext(req);
    res.json(await startDirectStudentPayment(pool,{schoolId:sid.data,...s.data,actorId:c.user.id,
      email:c.user.email,idempotencyKey:req.get("Idempotency-Key")??""}));
  }catch(e){safeError(res,e);}
});
router.post("/schools/:schoolId/platform-subscriptions/assistance",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const sid=positive.safeParse(req.params.schoolId);
  const body=scope.extend({requestNote:z.string().trim().min(3).max(500)}).strict().safeParse(req.body);
  if(!sid.success||!body.success){res.status(400).json({error:"Invalid request."});return;}
  if(!schoolAdmin(req,sid.data)){res.status(403).json({error:"School Admin required."});return;}
  // Requests are not bank credit. No provider POST/GET or obligation conversion occurs here.
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    if(!(await readStudentRollout(c,sid.data,body.data.termId)).chargeable)
      throw new DirectPaymentBlocked("FREE_ROLLOUT_NO_PLATFORM_PAYMENT");
    const valid=(await c.query(`SELECT st.id FROM students st JOIN academic_terms t ON t.id=$3 AND t.school_id=st.school_id
      WHERE st.school_id=$1 AND st.id=$2 AND lower(st.status)='active'`,
      [sid.data,body.data.studentId,body.data.termId])).rows[0];
    if(!valid)throw new DirectPaymentBlocked("STUDENT_TERM_NOT_FOUND",404);
    const actor=getUserContext(req).user;
    const r=(await c.query(`INSERT INTO subscription_payment_assistance_requests
      (school_id,student_id,academic_term_id,amount_minor,request_note,created_by)
      VALUES($1,$2,$3,320000,$4,$5) RETURNING id,status`,
      [sid.data,body.data.studentId,body.data.termId,body.data.requestNote,actor.id])).rows[0];
    await c.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,metadata)
      VALUES($1,'SCHOOL_ADMIN',$2,$3,'ASSISTANCE_REQUESTED','Subscription & Payment Rules',$4,
      'SUBSCRIPTION_RULE_ASSISTANCE_REQUESTED',$5::jsonb)`,
      [actor.email,actor.id,actor.clerkUserId,r.id,JSON.stringify({schoolId:sid.data,...body.data,amountMinor:320000})]);
    await c.query("COMMIT");res.status(201).json({id:Number(r.id),status:r.status});
  }catch(e){
    await c.query("ROLLBACK").catch(()=>undefined);
    if((e as any)?.code==="23505")res.status(409).json({error:"An existing assistance request must be resolved; no duplicate was created."});
    else safeError(res,e);
  }finally{c.release();}
});
router.post("/platform/subscription-payment-assistance/:id/checkout",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(!owner(req)){res.status(403).json({error:"Active global Owner required."});return;}
  const id=positive.safeParse(req.params.id);
  if(!id.success){res.status(400).json({error:"Invalid request."});return;}
  try{
    // No shared request-body bank or identity claims can replace the saved independent attestation.
    const r=(await pool.query(`SELECT school_id,student_id,academic_term_id FROM subscription_payment_assistance_requests WHERE id=$1`,[id.data])).rows[0];
    if(!r)throw new DirectPaymentBlocked("ASSISTANCE_NOT_FOUND",404);
    const u=getUserContext(req).user;
    res.json(await startDirectStudentPayment(pool,{schoolId:r.school_id,studentId:r.student_id,termId:r.academic_term_id,
      assistanceId:id.data,actorId:u.id,email:u.email,idempotencyKey:req.get("Idempotency-Key")??""}));
  }catch(e){safeError(res,e);}
});
export default router;

// Public callbacks reveal only an unguessable reference's state, never student/family metadata.
export const directStudentPublicRouter=Router();
directStudentPublicRouter.get("/flutterwave/direct-student/callback",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(!directLiveConfiguration().ready){res.status(409).json({error:"DIRECT_LIVE_RELEASE_DISABLED"});return;}
  const body=z.object({tx_ref:z.string().regex(/^SCV4_live_[A-Za-z0-9_-]{8,80}$/),
    transaction_id:z.string().regex(/^[1-9][0-9]{0,15}$/)}).safeParse(req.query);
  if(!body.success){res.status(400).json({error:"Invalid callback identifiers."});return;}
  try{res.json(await verifyDirectStudentPayment(pool,{reference:body.data.tx_ref,transactionId:body.data.transaction_id,actorId:null}));}
  catch(e){safeError(res,e);}
});
export const directStudentWebhookRouter=Router();
directStudentWebhookRouter.post("/",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  try{
    if(!Buffer.isBuffer(req.body))throw new DirectPaymentBlocked("RAW_WEBHOOK_REQUIRED",400);
    authenticateDirectStudentWebhook(req.headers);
    const parsed=z.object({event:z.literal("charge.completed"),
      data:z.object({id:z.union([z.string(),z.number().int().safe()]),tx_ref:z.string()})})
      .safeParse(JSON.parse(req.body.toString("utf8")));
    if(!parsed.success)throw new DirectPaymentBlocked("INVALID_WEBHOOK",400);
    res.json(await verifyDirectStudentPayment(pool,{reference:parsed.data.data.tx_ref,
      transactionId:String(parsed.data.data.id),actorId:null}));
  }catch(e){safeError(res,e);}
});
