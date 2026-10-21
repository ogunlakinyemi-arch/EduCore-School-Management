import { Router,type IRouter } from "express";
import { z } from "zod";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { blockedLiveWorkflow,requireLiveWorkflow,type LiveWorkflowCapability } from "../lib/flutterwave-live-workflow-gate";
import { LiveFinalizationBlocked,type LiveCollectionVerifier } from "../lib/flutterwave-live-verification";
import { AuthError,getUserContext,isPlatformOwner,requireAuthentication } from "../middlewares/auth";
import { listLiveOperatorReceipts,reviewLiveReceipt } from "../services/flutterwave-live-operator";
import { readLiveApplicationReceipt } from "../services/flutterwave-live-application";
import { previewLiveEvidence } from "../services/flutterwave-live-evidence-preview";

const reviewBody=z.object({
  action:z.enum(["REVIEW","CONFIRM_DURABILITY","RETRY"]),
  reason:z.enum(["PENDING","DUPLICATE","UNCERTAIN_COMMIT","REFUND","REVERSAL","DISPUTE"]),
  idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  originalBodyBase64:z.string().max(87384).optional(),
}).strict();
const positive=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** Mounted Owner API surface. Enabled deps exist only in disposable fixture code;
 * real application construction supplies the pool and no enabling capability. */
export function createLiveReadinessRouter(deps:{pool:StudentSubscriptionSqlPool;capability?:LiveWorkflowCapability;
  development?:boolean;verifier?:LiveCollectionVerifier}):IRouter{
  const router=Router(),capability=deps.capability??blockedLiveWorkflow;
  router.use("/platform/live-readiness",requireAuthentication());
  // Read-only preview deliberately does not require an enabled financial
  // capability. Owner + Development are checked before parsing or DB access.
  router.post("/platform/live-readiness/evidence-preview",async(req,res,next)=>{
    res.setHeader("Cache-Control","no-store");
    try{
      if(!isPlatformOwner(getUserContext(req)))throw new AuthError(403,"Platform Owner permission required");
      if(!(deps.development??(process.env.NODE_ENV==="development"&&!process.env.REPLIT_DEPLOYMENT)))
        throw new AuthError(503,"LIVE evidence preview is Development-only");
      const body=z.object({merchantScope:z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
        schoolId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        reviewId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        authorityEvidence:z.record(z.string(),z.unknown())}).strict().parse(req.body);
      res.json(await previewLiveEvidence(deps.pool,{...body,authorityEvidence:body.authorityEvidence}));
    }catch(error){
      if(error instanceof z.ZodError){next(new AuthError(400,"Invalid LIVE evidence preview"));return;}
      if(error instanceof AuthError){next(error);return;}
      next(new AuthError(503,"LIVE evidence preview unavailable; no approval or persistence occurred"));
    }
  });
  const wrap=(handler:(req:any,res:any,actorId:number,merchantScope:string)=>Promise<void>)=>
    async(req:any,res:any,next:any)=>{
      try{
        res.setHeader("Cache-Control","no-store");
        const context=getUserContext(req);
        if(!isPlatformOwner(context))throw new AuthError(403,"Platform Owner permission required");
        requireLiveWorkflow(capability);
        const development=deps.development??(process.env.NODE_ENV==="development"&&!process.env.REPLIT_DEPLOYMENT);
        if(!development)throw new AuthError(503,"LIVE readiness review is Development-only");
        const merchantScope=z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).parse(req.query.merchantScope);
        await handler(req,res,context.user.id,merchantScope);
      }catch(error){
        if(error instanceof LiveFinalizationBlocked){
          next(new AuthError(error.code.includes("OWNER_REQUIRED")?403:error.code.includes("DISABLED")?503:409,error.code));return;
        }
        if(error instanceof z.ZodError){next(new AuthError(400,"Invalid LIVE readiness request"));return;}
        next(error);
      }
    };
  router.get("/platform/live-readiness/receipts",wrap(async(_req,res,actorId,merchantScope)=>{
    res.json(await listLiveOperatorReceipts(deps.pool,{actorId,merchantScope,development:true,capability}));
  }));
  router.post("/platform/live-readiness/receipts/:receiptId/reviews",wrap(async(req,res,actorId,merchantScope)=>{
    const body=reviewBody.parse(req.body);
    let originalBody:Buffer|undefined;
    if(body.originalBodyBase64!==undefined){
      originalBody=Buffer.from(body.originalBodyBase64,"base64");
      if(originalBody.toString("base64")!==body.originalBodyBase64)throw new AuthError(400,"Original body must be canonical base64");
    }
    res.json(await reviewLiveReceipt(deps.pool,{actorId,merchantScope,development:true,capability},
      {receiptId:positive.parse(req.params.receiptId),action:body.action,reason:body.reason,
        idempotencyKey:body.idempotencyKey,originalBody},deps.verifier));
  }));
  router.get("/platform/live-readiness/receipts/:receiptId/official-receipt",wrap(async(req,res,actorId,merchantScope)=>{
    // Owner permission rechecked in the bounded review read, before any receipt.
    const review=await listLiveOperatorReceipts(deps.pool,{actorId,merchantScope,development:true,capability},positive.parse(req.params.receiptId));
    const row=review.receipts[0];
    if(!row?.intent_id)throw new AuthError(404,"Verified receipt binding unavailable");
    // This explicit LIVE ID namespace never translates shared payment IDs.
    const client=await deps.pool.connect();
    try{res.json(await readLiveApplicationReceipt(client,{intentId:Number(row.intent_id),schoolId:row.school_id,
      studentId:row.student_id,termId:row.term_id},{merchantScope,capability}));}finally{client.release();}
  }));
  return router;
}
