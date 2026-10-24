import {Router,type Request,type Response} from "express";
import {z} from "zod";
import {requireAuthentication,getUserContext} from "../middlewares/auth";
import {LiveOnboardingBlocked} from "../lib/flutterwave-live-onboarding-provider";
import {PayrollEncryptionConfigurationError} from "../lib/payroll-bank-encryption";
import type {StudentSubscriptionSqlPool} from "../lib/student-subscription-billing";
import {listLiveSchoolOnboarding,submitLiveSchoolOnboarding,reviewLiveSchoolOnboarding,liveOnboardingReview} from "../services/flutterwave-live-school-onboarding";
import * as Contract from "@workspace/api-zod";

export function createLiveSchoolOnboardingRouter({pool,env=process.env,fetcher=fetch}:{
  pool:StudentSubscriptionSqlPool;env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;
}){
  const router=Router(),id=z.coerce.number().int().positive().max(2147483647);
  const run=(handler:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    res.setHeader("Cache-Control","private, no-store");
    try{await handler(req,res);}
    catch(e){
      if(e instanceof z.ZodError){res.status(400).json({error:"Invalid LIVE onboarding request",code:"LIVE_ONBOARDING_INPUT_INVALID"});return;}
      const code=e instanceof LiveOnboardingBlocked?e.code:e instanceof PayrollEncryptionConfigurationError?
        "BANK_ENCRYPTION_CONFIGURATION_REQUIRED":"LIVE_ONBOARDING_OPERATION_UNCONFIRMED";
      const status=code==="LIVE_ONBOARDING_AUTHORITY_DENIED"?403:code==="LIVE_SCHOOL_ONBOARDING_NOT_FOUND"?404:503;
      res.status(status).json({error:code,code,processed:status===403||status===404?false:"UNCONFIRMED",providerHttpStatus:e instanceof LiveOnboardingBlocked?e.providerHttpStatus:null,
        nextAction:"Refresh status before retrying. Uncertain creations permit read-only recovery only; no TEST fallback."});
    }
  };
  router.get("/flutterwave/live/school-subaccounts",requireAuthentication(),run(async(req,res)=>{
    const {schoolId}=z.object({schoolId:id.optional()}).strict().parse(req.query);
    res.json(Contract.GetLiveSchoolSubaccountsResponse.parse(await listLiveSchoolOnboarding(
      pool,getUserContext(req).user.id,schoolId,env)));
  }));
  router.post("/schools/:schoolId/finance/live-subaccount-onboarding",requireAuthentication(),run(async(req,res)=>{
    // No caller-supplied account, school ownership, provider ID, status or mode.
    if(req.body&&Object.keys(req.body).length)throw new z.ZodError([]);
    res.json(Contract.SubmitLiveSchoolSubaccountResponse.parse(await submitLiveSchoolOnboarding(
      pool,getUserContext(req).user.id,id.parse(req.params.schoolId),env,fetcher)));
  }));
  router.post("/platform/flutterwave/live/school-subaccounts/:onboardingId/review",requireAuthentication(),run(async(req,res)=>{
    res.json(Contract.ReviewLiveSchoolSubaccountResponse.parse(await reviewLiveSchoolOnboarding(
      pool,getUserContext(req).user.id,id.parse(req.params.onboardingId),liveOnboardingReview.parse(req.body),env,fetcher)));
  }));
  return router;
}
