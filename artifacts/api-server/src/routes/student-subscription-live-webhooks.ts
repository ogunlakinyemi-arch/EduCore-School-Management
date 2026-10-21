import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { configuredLiveStudentSubscriptionAdapter } from "../lib/fee-providers/factory";
import type { FlutterwaveLiveAdapter } from "../lib/fee-providers";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { blockedLiveWorkflow, type LiveWorkflowCapability } from "../lib/flutterwave-live-workflow-gate";
import { blockedLiveCollectionVerifier, type LiveCollectionVerifier } from "../lib/flutterwave-live-verification";
import { persistAuthenticatedLiveWebhookReceipt } from "../services/flutterwave-live-webhook-inbox";
import { processLiveWorkflow } from "../services/flutterwave-live-lifecycle";

/** Server-owned dependencies only; request data and environment flags cannot
 * provide capabilities. Enabled dependencies belong to isolated fictional tests.
 * Even fixture finalization NEVER grants HTTP acknowledgement/release authority.
 */
export function createStudentSubscriptionLiveWebhookRouter(deps: {
  pool: StudentSubscriptionSqlPool;
  authenticator?: () => Pick<FlutterwaveLiveAdapter,"authenticateWebhook"> | null;
  capability?: LiveWorkflowCapability;
  verifier?: LiveCollectionVerifier;
}): IRouter {
  const router=Router();
  const capability=deps.capability??blockedLiveWorkflow;
  const verifier=deps.verifier??blockedLiveCollectionVerifier;
  router.post("/",async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    if(!Buffer.isBuffer(req.body)||req.body.length===0||req.body.length>65_536){
      res.status(400).json({error:"Webhook body is invalid",processed:false});return;
    }
    let adapter:Pick<FlutterwaveLiveAdapter,"authenticateWebhook">|null;
    try{adapter=(deps.authenticator??configuredLiveStudentSubscriptionAdapter)();}
    catch{res.status(503).json({error:"LIVE configuration unavailable",processed:false});return;}
    if(!adapter){res.status(503).json({error:"Flutterwave LIVE configuration is disabled, missing or mismatched",processed:false});return;}
    try{adapter.authenticateWebhook(req.headers);}
    catch{res.status(401).json({error:"Flutterwave LIVE webhook authentication failed",processed:false});return;}
    // Authentication precedes ALL DB acquisition. Original bytes are never
    // reconstructed from claims, JSON, a fingerprint or the stored diagnostics.
    let receiptId:number;
    try{receiptId=await persistAuthenticatedLiveWebhookReceipt(deps.pool,req.body);}
    catch{res.status(503).json({error:"Flutterwave LIVE receipt unavailable; financial processing remains blocked",processed:false});return;}
    if(capability.enabled&&verifier.enabled){
      try{
        const result=await processLiveWorkflow(deps.pool,receiptId,req.body,verifier,capability);
        res.status(503).json({...result,processed:false,receiptRecorded:true});return;
      }catch{
        res.status(503).json({error:"LIVE processing unresolved; reconciliation required",processed:false,receiptRecorded:true});return;
      }
    }
    res.status(503).json({
      error:"Flutterwave LIVE processing remains blocked pending merchant evidence and release review",
      processed:false,receiptRecorded:true,
    });
  });
  return router;
}

/** Actual application wiring: immutable defaults remain blocked. */
export const studentSubscriptionLiveWebhookRouter=createStudentSubscriptionLiveWebhookRouter({pool});
