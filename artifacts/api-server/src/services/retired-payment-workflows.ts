import type { RequestHandler } from "express";

/** Archive workflows, not records. Historical webhooks/verification are not new checkout. */
export function retiredPaymentWorkflow(path: string, method: string): boolean {
  let decoded:string;
  try{decoded=decodeURIComponent(path.split("?")[0]).toLowerCase();}catch{return true;}
  const p=decoded.replace(/^\/api(?=\/|$)/,"").replace(/\/+$/,"");
  if (/^\/hosted-payments(?:\/|$)/.test(p) || /^\/flutterwave\/split-/.test(p)) return true;
  if (/^\/flutterwave\/live\/school-subaccounts(?:\/|$)/.test(p) ||
      /^\/platform\/flutterwave\/live\/school-subaccounts(?:\/|$)/.test(p)) return true;
  if(/^\/schools\/\d+\/finance\/live-subaccount-onboarding(?:\/|$)/.test(p))return true;
  if (!["POST","PUT","PATCH","DELETE"].includes(method.toUpperCase())) return false;
  return /^\/schools\/\d+\/finance\/(?:live-subaccount-onboarding|payment-settlement)(?:\/|$)/.test(p) ||
    /^\/student-nfc\/assisted-requests(?:\/|$)/.test(p) ||
    /^\/platform\/finance\/payment-settlement\/schools\/\d+(?:\/|$)/.test(p) ||
    /^\/flutterwave\/live\/(?:checkout|school-configuration|allocation-review)$/.test(p) ||
    /^\/subscriptions\/\d+\/(?:checkout|payment-link)$/.test(p) ||
    /^\/public\/nfc-payment-links\/checkout$/.test(p);
}
export const rejectRetiredPaymentWorkflows:RequestHandler=(req,res,next)=>{
  if(!retiredPaymentWorkflow(req.originalUrl,req.method)){next();return;}
  res.setHeader("Cache-Control","no-store");
  res.status(410).json({code:"PAYMENT_WORKFLOW_ARCHIVED",
    error:"This legacy settlement or hosted checkout workflow is archived and unavailable. Historical records are retained. No payment was initiated.",
    platformBilling:"Student platform payments require a reviewed active rule and separate verified payment; school splits and hosted checkout are not supported."});
};
