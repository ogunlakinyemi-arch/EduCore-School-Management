/**
 * Explicit, one-shot provider-only TEST verification. No school/Partner records,
 * fee payments, flags, transfers, refunds, Production access or migrations.
 * Run from scripts: NODE_ENV=development pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/tools/flutterwave-sandbox-probe.ts onboard|checkout|verify
 */
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { FlutterwaveSplitProvider } from "../services/flutterwave-split-provider";
import { developmentFlutterwaveCredential } from "../lib/flutterwave-development-config";
import { fixedSplitInstructions, requireSplitDevelopment } from "../lib/flutterwave-split-policy";
import { safeEnvelope, sandboxBank } from "./flutterwave-sandbox-evidence";

const privateFile=new URL("../../../../.local/flutterwave-split-probe/state.json",import.meta.url);
const reportFile=new URL("../../../../reports/flutterwave-splits/sandbox-verification.json",import.meta.url);
async function save(file:URL,value:unknown) {
  await fs.mkdir(new URL(".",file),{recursive:true});
  const tmp=new URL(`${file.href}.tmp`);
  await fs.writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});
  await fs.rename(tmp,file);
}
export async function runProbe(action:string) {
  requireSplitDevelopment();
  if (!["onboard","onboard-correct-email","checkout","verify","snapshot"].includes(action)) throw new Error("Use onboard, checkout, verify or snapshot");
  const credential=developmentFlutterwaveCredential();
  if (credential.state !== "CONFIGURED") throw new Error("Dedicated TEST credential unavailable");
  await fs.mkdir(new URL(".",privateFile),{recursive:true});
  const lockFile=new URL("execution.lock",privateFile);
  const lock=await fs.open(lockFile,"wx",0o600).catch(()=>{throw new Error("Probe is locked; reconcile before any further execution");});
  try {
  let state:any;
  try { state=JSON.parse(await fs.readFile(privateFile,"utf8")); }
  catch(e:any) { if(e.code !== "ENOENT") throw new Error("Probe state unreadable; do not resubmit");
    state={version:1,reference:`fw_split_probe_${randomUUID().replaceAll("-","")}`}; }
  let report:any;
  try { report=JSON.parse(await fs.readFile(reportFile,"utf8")); }
  catch(e:any) { if(e.code !== "ENOENT") throw new Error("Probe report unreadable");
    report={startedAt:new Date().toISOString(),mode:"GENUINE PROVIDER TEST ONLY",fixture:sandboxBank,
      expected:{amount:5000,currency:"NGN",recipientGross:2000,platformGrossBeforeCosts:3000},
      databaseWrites:"NONE BY THIS PROBE",eduCoreSplitMode:"NOT CHANGED",
      settlement:"INACTIVE IN TEST PER USER-RELAYED SUPPORT; NOT DEMONSTRATED",calls:[]}; }
  const persist=async()=>{await save(privateFile,state);await save(reportFile,report);};
  const transport:typeof fetch=async(input,init)=>{
    requireSplitDevelopment();
    const url=new URL(String(input));
    if (url.origin !== "https://api.flutterwave.com" || !url.pathname.startsWith("/v3/")) throw new Error("Provider origin refused");
    const method=init?.method ?? "GET";
    if (method === "POST" && !["/v3/accounts/resolve","/v3/subaccounts","/v3/payments"].includes(url.pathname))
      throw new Error("Provider mutation refused");
    if (!["GET","POST"].includes(method)) throw new Error("Provider method refused");
    const row:any={at:new Date().toISOString(),method,url:url.href,httpStatus:null};
    report.calls.push(row);
    await persist();
    try {
      const response=await fetch(input,init);
      row.httpStatus=response.status;
      const payload:any=await response.clone().json();
      row.response=safeEnvelope(payload);
      await persist();
      return response;
    } catch { row.transportOutcome="UNCONFIRMED; NEVER RETRY POST";await persist();
      throw new Error("Provider response unavailable; reconcile read-only"); }
  };
  const provider=new FlutterwaveSplitProvider(credential.secret!,{fetch:transport});
  const get=async(path:string)=>{
    const response=await transport(`https://api.flutterwave.com/v3/${path}`,{
      method:"GET",headers:{Authorization:`Bearer ${credential.secret}`,Accept:"application/json"},
      redirect:"error",signal:AbortSignal.timeout(15000),
    });
    const body:any=await response.json();
    return {response,body};
  };
  try {
    if (action === "onboard" || action === "onboard-correct-email") {
      const correcting=action === "onboard-correct-email";
      const creates=report.calls.filter((r:any)=>r.method==="POST" && r.url.endsWith("/subaccounts"));
      if (correcting) {
        const rejected=creates[0];
        if (!state.creationAttempted || state.emailCorrectionAttempted || creates.length !== 1
          || rejected?.httpStatus !== 400 || rejected?.response?.status !== "error"
          || rejected?.response?.message !== "business_email is required" || rejected?.response?.data !== null)
          throw new Error("Correction allowed only for the exact confirmed missing-email validation rejection");
      } else if (state.creationAttempted) throw new Error("Creation already attempted; never repeat an uncertain POST");
      const list=await get("subaccounts?page=1");
      if (!(list.response.status === 400 && list.body.message === "Subaccounts not found" && list.body.data === null)
        && !(list.response.ok && list.body.status === "success" && Array.isArray(list.body.data))) {
        throw new Error("Pre-creation listing could not be established");
      }
      if (Array.isArray(list.body.data) && list.body.data.some((d:any)=>d.account_number === sandboxBank.accountNumber
        && String(d.account_bank) === sandboxBank.bankCode)) throw new Error("Fixture bank already has a recipient; manual review required");
      if (correcting && !(list.response.status === 400 && list.body.status === "error"
        && list.body.message === "Subaccounts not found" && list.body.data === null))
        throw new Error("Correction requires the same independently confirmed no-record response");
      if (Number(list.body.meta?.page_info?.total_pages ?? 1)>1) throw new Error("Preflight listing requires pagination review");
      const bank={...sandboxBank,...await provider.resolveBank(sandboxBank.bankCode,sandboxBank.accountNumber),
        ...(correcting ? {businessEmail:"split-probe@example.test"} : {})};
      report.bankResolution="GENUINE MATCH OF OFFICIAL TEST FIXTURE";
      state.creationAttempted=true;
      if (correcting) state.emailCorrectionAttempted=true;
      await persist(); // Durable intent before the single creation POST.
      const recipient=await provider.createRecipient(bank,"SCHOOL");
      state.recipient=recipient;
      const listed=await get("subaccounts?page=1");
      const matches=Array.isArray(listed.body.data) ? listed.body.data.filter((d:any)=>d.id === recipient.providerId) : [];
      const d=matches[0];
      if (!listed.response.ok || listed.body.status !== "success" || matches.length !== 1
        || d.subaccount_id !== recipient.subaccountId || d.account_number !== sandboxBank.accountNumber
        || String(d.account_bank) !== sandboxBank.bankCode || d.split_type !== "flat" || Number(d.split_value)!==3000) {
        throw new Error("Independent list read-back mismatch");
      }
      const created=report.calls.filter((r:any)=>r.method==="POST" && r.url.endsWith("/subaccounts")).at(-1)?.response?.data;
      if (created?.id !== d.id || created?.subaccount_id !== d.subaccount_id) throw new Error("Creation/list identities differ");
      state.recipientVerified=true;
      if (d.business_name !== sandboxBank.entityName) throw new Error("Independent business label mismatch");
      report.recipient={...recipient,independentListMatched:true,defaultSplitMatched:true,
        providerEnvelopeStatus:listed.body.status,providerActiveStatus:d.status ?? null,
        activeStatusNote:d.status == null ? "Provider returned no active/status field; no active claim" : "Provider field only"};
    }
    if (action === "checkout") {
      if (!state.recipientVerified) throw new Error("Independent recipient verification required");
      if (state.checkoutAttempted) throw new Error("Checkout already attempted; never reinitialize");
      const subaccounts=fixedSplitInstructions(state.recipient.subaccountId,null);
      const input={reference:state.reference,amountMinor:500000,currency:"NGN",email:"split-probe@example.test",
        customerName:"EDUCORE TEST ONLY",returnUrl:`https://${process.env.REPLIT_DEV_DOMAIN}/`,subaccounts};
      state.checkoutAttempted=true;
      report.checkoutRequest={tx_ref:state.reference,amount:5000,currency:"NGN",subaccounts,
        feePolicy:"Merchant bears costs; browser must stop if total exceeds NGN 5000"};
      await persist();
      const result=await provider.initializePayment(input);
      state.checkoutUrl=result.checkoutUrl; // Capability URL stays private and is excluded from public evidence.
      report.checkout={initialized:true,reference:state.reference,host:new URL(result.checkoutUrl).host,
        transactionStatus:"NOT YET VERIFIED"};
    }
    if (action === "verify") {
      if (!state.checkoutAttempted) throw new Error("No checkout attempt to verify");
      const found=await get(`transactions/verify_by_reference?tx_ref=${state.reference}`);
      const d=found.body.data;
      if (!found.response.ok || found.body.status !== "success" || d?.tx_ref !== state.reference || !Number.isSafeInteger(d.id))
        throw new Error("Provider transaction not available for this reference");
      const verified=await provider.verifyPayment({reference:state.reference,amountMinor:500000,currency:"NGN",
        providerTransactionId:String(d.id)});
      report.verifiedPayment=verified;
      report.payerAmountMatched=verified.providerChargedAmountMinor === 500000;
      report.splitEvidenceNote="Requested instructions are not proof of returned splits; inspect recorded provider fields separately.";
      if (verified.status !== "succeeded") throw new Error("Transaction is not independently verified successful");
      if (!report.payerAmountMatched) throw new Error("Payer amount is not exactly NGN 5000");
      state.transactionId=d.id;
    }
    if (action === "snapshot") {
      const observation=JSON.parse(await fs.readFile(new URL("browser-observation.json",privateFile),"utf8"));
      if (observation.status !== "not_submitted" || observation.chargeSubmissionCount !== 0
        || observation.amount !== 5000 || observation.currency !== "NGN"
        || observation.transactionId !== null || !state.checkoutAttempted || state.transactionId)
        throw new Error("Browser observation does not establish an unsubmitted TEST checkout");
      report.checkout.transactionStatus="NOT SUBMITTED: browser stopped before card entry";
      report.checkout.browserObserved={amount:5000,currency:"NGN",testMode:true,chargeSubmissions:0,
        merchantIdentity:"NOT CONFIRMED",returnedSplitFields:[]};
      report.webhook={status:"NO DELIVERED WEBHOOK OBSERVED",rawPayload:"NOT AVAILABLE",
        note:"The probe never configures or replays webhooks; a transaction was not submitted"};
      report.lastOutcome="HOSTED CHECKOUT BLOCKED BEFORE PAYMENT";
      report.blocker="Merchant identity not verifiable on hosted TEST checkout; no card entered and no charge submitted";
    } else {
      report.lastOutcome=`${action.toUpperCase()} CONFIRMED`;
      delete report.blocker;
    }
  } catch(e) {
    report.lastOutcome=`${action.toUpperCase()} STOPPED`;
    report.blocker=e instanceof Error ? e.message : "Operation unconfirmed";
    await persist();
    console.log(JSON.stringify(report,null,2));
    throw new Error("TEST probe stopped; see sanitized report. Do not repeat a POST.");
  }
  await persist();
  console.log(JSON.stringify(report,null,2));
  } finally { await lock.close();await fs.unlink(lockFile); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { await runProbe(process.argv[2] ?? ""); }
  catch { process.exitCode=1; }
  finally { await pool.end(); }
}
