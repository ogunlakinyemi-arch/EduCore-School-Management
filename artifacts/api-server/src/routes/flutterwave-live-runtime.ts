import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { getUserContext,requireAuthentication } from "../middlewares/auth";
import { initializeLiveSubscriptionCheckout,verifyLiveCallback } from "../services/flutterwave-live-runtime";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";
import { saveLiveSchoolConfiguration,saveLiveAllocationReview } from "../services/flutterwave-live-configuration";
import { liveReleaseConfiguration,requireLiveRelease } from "../lib/flutterwave-live-release";
import { createSchoolBillingContextRouter } from "./flutterwave-school-billing";
import { createLiveSchoolOnboardingRouter } from "./flutterwave-live-school-onboarding";

const router=Router();
router.use(createSchoolBillingContextRouter({pool}));
router.use(createLiveSchoolOnboardingRouter({pool}));
const isOwner=(req:Parameters<typeof getUserContext>[0])=>getUserContext(req).roles
  .some(r=>r.role==="PLATFORM_OWNER"&&r.schoolId===null&&r.status==="ACTIVE");
router.get("/flutterwave/live/release-check",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","private, no-store");
  if(!isOwner(req)){res.status(403).json({error:"Platform Owner access required"});return;}
  const configuration=liveReleaseConfiguration();
  if(!configuration.ready){res.json({ready:false,blockers:configuration.blockers});return;}
  try {
    await requireLiveRelease(pool);
    res.json({ready:true,blockers:[],schoolReadiness:"REQUIRES_CURRENT_SCHOOL_AUTHORITY_REVIEW",
      transactionFinalization:"REQUIRES_VERIFIED_COLLECTION_AND_TRANSACTION_ALLOCATION_REPORT"});
  }catch{res.json({ready:false,blockers:["TARGET_SCHEMA_OR_RELEASE_APPROVAL"]});}
});
router.post("/flutterwave/live/school-configuration",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","private, no-store");
  if(!isOwner(req)){res.status(403).json({error:"Platform Owner access required"});return;}
  const body=z.object({evidence:z.unknown(),expiresAt:z.string().datetime()}).strict().safeParse(req.body);
  if(!body.success){res.status(400).json({error:"Invalid school configuration review"});return;}
  try {res.json(await saveLiveSchoolConfiguration(pool,{actorId:getUserContext(req).user.id,
    evidence:body.data.evidence,expiresAt:body.data.expiresAt}));}
  catch{res.status(503).json({error:"LIVE_SCHOOL_CONFIGURATION_REVIEW_UNAVAILABLE",processed:false});}
});
router.post("/flutterwave/live/allocation-review",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","private, no-store");
  if(!isOwner(req)){res.status(403).json({error:"Platform Owner access required"});return;}
  const body=z.object({reference:z.string().regex(/^SCV3_live_[A-Za-z0-9_-]{8,80}$/),
    transactionId:z.string().regex(/^[1-9][0-9]{0,15}$/),evidenceSha256:z.string().regex(/^[a-f0-9]{64}$/),
    schoolSubaccountId:z.string().regex(/^RS_[A-Za-z0-9]{12,80}$/),providerReference:z.string().min(1).max(200),
    grossMinor:z.literal(500000),schoolMinor:z.literal(190000),currency:z.literal("NGN"),
    source:z.literal("FLUTTERWAVE_TRANSACTION_REPORT")}).strict().safeParse(req.body);
  if(!body.success){res.status(400).json({error:"Invalid transaction allocation review"});return;}
  try {res.json(await saveLiveAllocationReview(pool,{actorId:getUserContext(req).user.id,...body.data}));}
  catch{res.status(503).json({error:"LIVE_ALLOCATION_REVIEW_UNAVAILABLE",processed:false});}
});
const checkout=z.object({schoolId:z.number().int().positive(),studentId:z.number().int().positive(),
  termId:z.number().int().positive(),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)}).strict();
router.post("/flutterwave/live/checkout",requireAuthentication(),async(req,res)=>{
  if(process.env.EDUCORE_HOSTED_PAYMENTS_ENABLED==="true"){
    res.status(409).json({error:"New collections use Hosted Payments; original references retain their original reconciliation.",
      code:"HOSTED_CHECKOUT_REQUIRED"});return;
  }
  res.setHeader("Cache-Control","private, no-store");
  const parsed=checkout.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid LIVE checkout input"});return;}
  const context=getUserContext(req);
  // The SQL issuance boundary rechecks canonical active membership and Owner exclusion.
  if(!context.roles.some(r=>r.role==="SCHOOL_ADMIN"&&r.schoolId===parsed.data.schoolId&&r.status==="ACTIVE")
    ||context.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.status==="ACTIVE")){
    res.status(403).json({error:"Current school administration access is required"});return;
  }
  try {
    res.json(await initializeLiveSubscriptionCheckout(pool,{...parsed.data,actorId:context.user.id,
      email:context.user.email??""}));
  }catch(error){
    res.status(503).json({error:error instanceof LiveFinalizationBlocked?error.code:"LIVE_CHECKOUT_UNAVAILABLE",processed:false});
  }
});
router.get("/flutterwave/live/callback",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const parsed=z.object({transaction_id:z.string().regex(/^[1-9][0-9]{0,15}$/),
    tx_ref:z.string().regex(/^SCV3_live_[A-Za-z0-9_-]{8,80}$/),status:z.string().optional()}).strict().safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:"LIVE_CALLBACK_INVALID",processed:false});return;}
  try {
    const result=await verifyLiveCallback(pool,{transactionId:parsed.data.transaction_id,reference:parsed.data.tx_ref});
    res.status(result.processed?200:202).json(result);
  }catch(error){
    res.status(503).json({error:error instanceof LiveFinalizationBlocked?error.code:"LIVE_VERIFICATION_UNAVAILABLE",processed:false});
  }
});
export default router;
