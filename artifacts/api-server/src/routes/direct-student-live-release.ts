import {Router,type Request,type Response} from "express";
import {z} from "zod";
import {pool} from "@workspace/db";
import {requireAuthentication,getUserContext} from "../middlewares/auth";
import {previewDirectRelease,listDirectReleaseReviews,createDirectReleaseReview,decideDirectReleaseReview,
  DirectReleaseError,type ReleaseDependencies} from "../services/direct-student-live-release";
import type {StudentSubscriptionSqlPool} from "../lib/student-subscription-billing";
const positive=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const scope=z.object({schoolId:positive,termId:positive,ruleId:positive}).strict();
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const review=scope.extend({previewDigest:sha,merchantEvidenceReference:z.string().trim().min(8).max(300),
  merchantEvidenceHash:sha,noSplitConfirmed:z.literal(true),policy:z.literal("NEW_ONLY_PRESERVE_LEGACY"),
  expiresAt:z.string().datetime(),reason:z.string().trim().min(3).max(500)}).strict();
const decision=z.object({action:z.enum(["REVIEWED","APPROVED","REJECTED","EXPIRED"]),
  evidenceDigest:sha,reason:z.string().trim().min(3).max(500),confirmScope:z.boolean()}).strict();
/** Injectable only for credential-free isolated tests; runtime uses the existing application pool. */
export function createDirectReleaseRouter(db:StudentSubscriptionSqlPool=pool,deps:ReleaseDependencies={}){
  const router=Router(),base="/platform/direct-student-live";
  router.use(base,requireAuthentication(),(req,res,next)=>{
    res.setHeader("Cache-Control","private, no-store");
    const c=getUserContext(req);
    if(c.user.status!=="ACTIVE"||!c.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.schoolId===null&&r.status==="ACTIVE")
      ||c.roles.some(r=>r.status==="ACTIVE"&&["DEVICE_ACTIVATION_OFFICER","COMPANY_ACCOUNTANT"].includes(r.role))){
      res.status(403).json({error:"ACTIVE_GLOBAL_OWNER_REQUIRED"});return;
    }
    next();
  });
  const wrap=(fn:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response)=>{
    try{await fn(req,res);}catch(e){
      res.status(e instanceof DirectReleaseError?e.status:e instanceof z.ZodError?400:503)
        .json({error:e instanceof DirectReleaseError?e.code:e instanceof z.ZodError?"INVALID_DIRECT_REVIEW_INPUT":"DIRECT_RELEASE_REVIEW_UNAVAILABLE"});
    }
  };
  router.get(`${base}/readiness`,wrap(async(req,res)=>{
    res.json(await previewDirectRelease(db,scope.parse(req.query),deps));
  }));
  router.get(`${base}/reviews`,wrap(async(req,res)=>{
    res.json({reviews:await listDirectReleaseReviews(db,scope.parse(req.query))});
  }));
  router.post(`${base}/reviews`,wrap(async(req,res)=>{
    res.status(201).json(await createDirectReleaseReview(db,review.parse(req.body),getUserContext(req).user.id,deps));
  }));
  router.post(`${base}/reviews/:id/decisions`,wrap(async(req,res)=>{
    res.json(await decideDirectReleaseReview(db,positive.parse(req.params.id),decision.parse(req.body),
      getUserContext(req).user.id,deps));
  }));
  return router;
}
export default createDirectReleaseRouter();
