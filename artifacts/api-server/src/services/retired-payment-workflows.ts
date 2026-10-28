import type { RequestHandler } from "express";

/** No environment switch or old release approval can restore split issuance. */
export function rejectLegacySplitInitiation():void {
  throw Object.assign(new Error("Legacy split payment issuance and release approval are archived."),
    {code:"LEGACY_SPLIT_WORKFLOW_ARCHIVED"});
}

/** Archive workflows, not records. Historical webhooks/verification are not new checkout. */
export function retiredPaymentWorkflow(path: string, method: string): boolean {
  let decoded:string;
  try{decoded=decodeURIComponent(path.split("?")[0]).toLowerCase();}catch{return true;}
  const p=decoded.replace(/^\/api(?=\/|$)/,"").replace(/\/+$/,"");
  // Existing transaction evidence is an authenticated historical read, not an
  // issuance/configuration/release escape hatch.
  if (["GET","HEAD"].includes(method.toUpperCase()) &&
      /^\/flutterwave\/split-payments\/\d+\/transaction-evidence$/.test(p)) return false;
  if (/^\/hosted-payments(?:\/|$)/.test(p) || /^\/flutterwave\/(?:split-|local-split-simulation(?:\/|$))/.test(p)) return true;
  if (/^\/flutterwave\/live\/(?:release-check|billing-context)(?:\/|$)/.test(p)) return true;
  if (/^\/flutterwave\/live\/school-subaccounts(?:\/|$)/.test(p) ||
      /^\/platform\/flutterwave\/live\/school-subaccounts(?:\/|$)/.test(p)) return true;
  if(/^\/schools\/[^/]+\/finance\/live-subaccount-onboarding(?:\/|$)/.test(p))return true;
  if (!["POST","PUT","PATCH","DELETE"].includes(method.toUpperCase())) return false;
  // School settlement-account collection is retired. Preserve authorized
  // historical reads and separate parent-fee bank settings / Owner receiving accounts.
  return /^\/schools\/[^/]+\/finance\/payment-settlement(?:\/|$)/.test(p) ||
    /^\/student-nfc\/assisted-requests(?:\/|$)/.test(p) ||
    /^\/platform\/live-readiness\/evidence-preview$/.test(p) ||
    /^\/platform\/live-readiness\/receipts\/[^/]+\/reviews$/.test(p) ||
    /^\/platform\/finance\/payment-settlement\/schools\/[^/]+(?:\/|$)/.test(p) ||
    /^\/flutterwave\/live\/(?:checkout|school-configuration|allocation-review)$/.test(p) ||
    /^\/subscriptions\/[^/]+\/(?:checkout|payment-link)$/.test(p) ||
    /^\/public\/nfc-payment-links\/checkout$/.test(p);
}
export const rejectRetiredPaymentWorkflows:RequestHandler=(req,res,next)=>{
  if(!retiredPaymentWorkflow(req.originalUrl,req.method)){next();return;}
  res.setHeader("Cache-Control","no-store");
  res.status(410).json({code:"PAYMENT_WORKFLOW_ARCHIVED",
    error:"This legacy settlement or hosted checkout workflow is archived and unavailable. Historical records are retained. No payment was initiated.",
    platformBilling:"Student platform payments require a reviewed active rule and separate verified payment; school splits and hosted checkout are not supported."});
};
