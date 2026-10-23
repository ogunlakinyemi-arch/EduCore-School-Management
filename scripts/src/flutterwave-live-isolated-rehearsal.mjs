// Explicitly approved disposable-only SQL rehearsal. No application DB module,
// URL, provider, HTTP client, runtime workflow or migration-ledger import.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReview, reviewDrafts } from "./flutterwave-live-review.mjs";
import { NativeRehearsal, hash } from "./flutterwave-rehearsal/native.mjs";
import { emptyBaseline, finishEmpty, populatedBaseline, policyAndRetention, incompatibleBaseline } from "./flutterwave-rehearsal/scenarios.mjs";
import { isolatedCheckoutPolicy } from "./flutterwave-rehearsal/policy.mjs";

if(process.argv.length!==2)throw new Error("No target, URL, apply, approval or credential options are accepted.");
const allowed=new Set(["PATH","HOME","LANG","LC_ALL"]);
if(Object.keys(process.env).some(key=>!allowed.has(key)))throw new Error("Launch with env -i and only PATH/HOME/LANG/LC_ALL; inherited configuration is forbidden.");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
process.chdir(root);
const {manifest,sources}=loadReview(root),review=reviewDrafts(manifest,sources);
if(!review.offlineReviewPassed)throw new Error("Pinned hash/dependency gate failed: "+JSON.stringify(review.issues));
// Independently hash original bytes, not only the reviewer's decoded strings.
for(const stage of manifest.stages)for(const direction of ["up","down"]) {
  const bytes=fs.readFileSync(path.join(root,`lib/db/dev-reconciliation/flutterwave-live-${stage.name}.${direction}.sql`));
  if(hash(bytes)!==stage[direction+"Sha256"])throw new Error("Independent byte hash mismatch");
}
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"edupulse-fw-pinned-"));
fs.chmodSync(directory,0o700);
const runId=path.basename(directory);
const evidence=path.join(root,"generated-artifacts/flutterwave-live-rehearsal",runId);
fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const report={runId,startedAt:new Date().toISOString(),status:"RUNNING",manifest,staticReview:review,commands:[],checks:[],
  migrationApproved:false,applicationTargetCompatibilityVerified:false,publishedRuntimeBindingVerified:false,backupRestoreVerified:false,
  liveActivationAuthorized:false,provenanceMismatchWaived:false,
  boundaries:{inheritedConfiguration:false,applicationDatabaseConnected:false,providerCalled:false,ledgerEdited:false,serviceRestarted:false}};
report.tooling={node:process.version,sources:Object.fromEntries([
  "scripts/src/flutterwave-live-isolated-rehearsal.mjs","scripts/src/flutterwave-rehearsal/native.mjs",
  "scripts/src/flutterwave-rehearsal/scenarios.mjs","scripts/src/flutterwave-live-review.mjs",
  "scripts/src/flutterwave-rehearsal/policy.mjs",
  "scripts/src/live-readiness-target-schema.mjs",
].map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]))};
const r=new NativeRehearsal(directory,evidence,report);
try {
  report.tooling.versions={};
  for(const tool of ["psql","postgres","initdb","pg_dump","pg_restore"])
    report.tooling.versions[tool]=r.run(tool+"-version",tool,["--version"]).stdout.trim();
  const mode=fs.statSync(directory);
  r.check((mode.mode&0o077)===0&&mode.uid===process.getuid(),"fresh private owner-only cluster directory");
  const baselineFile=path.join(directory,"source-model.sql");
  r.run("offline-reviewed-source-export","pnpm",["--filter","@workspace/scripts","exec","tsx","src/live-readiness-target-schema.mjs","--out",baselineFile]);
  const baselineManifest=JSON.parse(fs.readFileSync(baselineFile+".json","utf8"));
  const baseline=fs.readFileSync(baselineFile,"utf8"),raw=fs.readFileSync(baselineFile+".raw.sql","utf8");
  r.check(baselineManifest.orderedSha256===hash(baseline)&&baselineManifest.rawSha256===hash(raw)
    &&baselineManifest.historicalOwnershipGuard==="PASS"&&baselineManifest.keyOwnership.every(k=>k.actualKind===k.expectedKind),
    "reviewed baseline hashes/current ownership guards, without modifying exporter or generic guards");
  report.baseline=baselineManifest;
  for(const suffix of ["",".raw.sql",".json"]) {
    const from=suffix?baselineFile+suffix:baselineFile;
    fs.copyFileSync(from,path.join(evidence,"source-model"+(suffix||".sql")));
  }
  await r.start();
  r.create("rehearsal_raw_export");
  const rawBefore=r.catalog("rehearsal_raw_export");
  // The unchanged raw baseline is not a migration draft and has no transaction
  // of its own. Its known failure is contained in a separate database/transaction.
  const rawResult=r.run("unchanged-raw-export-trial","psql",r.args("rehearsal_raw_export"),"BEGIN;\n"+raw+"\nCOMMIT;\n",true);
  report.rawExport={status:rawResult.status===0?"PASS":"FAIL",error:rawResult.stderr.trim()};
  r.equal(r.catalog("rehearsal_raw_export"),rawResult.status===0?r.catalog("rehearsal_raw_export"):rawBefore,
    "failed unchanged raw baseline leaves no partial catalog");
  const empty=emptyBaseline(r,sources);await finishEmpty(r,sources,empty);
  const populated=populatedBaseline(r,sources,baseline);
  const retained=policyAndRetention(r,sources,populated);
  incompatibleBaseline(r,sources);
  // Dump/restore ONLY the wholly fictional, newly initialized database.
  const backup=path.join(evidence,"synthetic-only.dump");
  r.run("synthetic-only-backup","pg_dump",["-h",directory,"-p","5432","-U","isolated_rehearsal",
    "-d",populated.db,"--format=custom","--no-owner","--no-privileges","--file",backup]);
  r.create("rehearsal_restored");
  r.run("synthetic-only-restore","pg_restore",["-h",directory,"-p","5432","-U","isolated_rehearsal",
    "-d","rehearsal_restored","--no-owner","--no-privileges","--exit-on-error",backup]);
  r.equal(r.data("rehearsal_restored"),retained.data,"synthetic backup restore retains every table row fingerprint");
  const restored=r.catalog("rehearsal_restored");
  fs.writeFileSync(path.join(evidence,"restored-inventory.json"),JSON.stringify(restored,null,2)+"\n");
  report.syntheticRecovery={dataVerified:true,exactCatalogMatch:hash(JSON.stringify(restored))===hash(JSON.stringify(retained.catalog)),
    backupSha256:hash(fs.readFileSync(backup)),backupScope:"new synthetic local database only; not application backup acceptance"};
  // Execute the current pure checkout allocation contract with fictional,
  // hash-bound authority evidence. No provider or application pool is imported.
  const authority=path.join(root,"artifacts/api-server/src/lib/flutterwave-live-split-authority.ts");
  const splitPolicy=path.join(root,"artifacts/api-server/src/lib/flutterwave-split-policy.ts");
  const allocationPolicy=path.join(root,"artifacts/api-server/src/lib/student-allocation-policy.ts");
  const policy=`import assert from 'node:assert/strict'; import {confirmedLiveSplitPreview,confirmedLiveSplitModel,verifyLiveSplitAuthority,liveSplitAuthorityDigest} from ${JSON.stringify(authority)};
    import {fixedSplitInstructions} from ${JSON.stringify(splitPolicy)}; import {studentAllocationPolicy} from ${JSON.stringify(allocationPolicy)};
    const a={version:1,provider:'FLUTTERWAVE',environment:'LIVE',merchantScope:'fictional_merchant',schoolId:10,schoolSubaccountId:'RS_FictionalSchool123',
    dashboardFeeBearer:'MERCHANT',dashboardFeeBearerEvidenceSha256:'a'.repeat(64),liveSubaccountVerified:true,schoolOwnershipVerified:true,schoolOwnershipEvidenceSha256:'b'.repeat(64)};
    const expected={merchantScope:a.merchantScope,schoolId:10,schoolSubaccountId:a.schoolSubaccountId,evidenceSha256:liveSplitAuthorityDigest(a)};
    assert.deepEqual(confirmedLiveSplitPreview(verifyLiveSplitAuthority(a,expected)),{amount:5000,currency:'NGN',subaccounts:[{id:a.schoolSubaccountId,transaction_charge_type:'flat_subaccount',transaction_charge:1900}]});
    assert.equal(confirmedLiveSplitModel.eligiblePartnerAmount,100); assert.equal(confirmedLiveSplitModel.transactionSplitRatio,'OMITTED');
    const partner='RS_FictionalPartner123';
    assert.deepEqual(fixedSplitInstructions(a.schoolSubaccountId,partner,3),[{id:a.schoolSubaccountId,transaction_charge_type:'flat_subaccount',transaction_charge:1900}]);
    assert.deepEqual(fixedSplitInstructions(a.schoolSubaccountId,partner,2),[
      {id:a.schoolSubaccountId,transaction_charge_type:'flat_subaccount',transaction_charge:1900},
      {id:partner,transaction_charge_type:'flat_subaccount',transaction_charge:100}]);
    assert.equal(studentAllocationPolicy('SCV2_synthetic_retained').deferredPartner,false);
    assert.equal(studentAllocationPolicy('SCV3_synthetic_current').deferredPartner,true);
    for(const extra of [{transaction_split_ratio:1},{partnerSubaccountId:'RS_FictionalPartner123'},{amount:5001},{schoolAmount:1901}])
      assert.throws(()=>verifyLiveSplitAuthority({...a,...extra},expected));
    console.log(JSON.stringify({status:'PASS',grossNGN:5000,schoolNGN:1900,schoolRecipients:1,chargeType:'flat_subaccount',ratioOmitted:true,partnerCheckoutRecipient:false,eligiblePartnerInternalNGN:100,historicalSCV2PolicyRetained:true,externalEvidence:false}));`;
  report.checkoutPolicy=await isolatedCheckoutPolicy(root,policy,r);
  // Re-read pins at the end; drafts and manifest must remain unchanged.
  const final=loadReview(root);
  r.check(JSON.stringify(final.manifest)===JSON.stringify(manifest)&&reviewDrafts(final.manifest,final.sources).offlineReviewPassed,
    "all eight pinned files and manifest unchanged after rehearsal");
  report.status="PASS";
} catch(error) {
  report.status="FAIL";report.failure=String(error.stack??error);
  process.exitCode=1;
} finally {
  await r.close();
  const locksFile=path.join(evidence,"locks.log");
  const samples=fs.existsSync(locksFile)?fs.readFileSync(locksFile,"utf8").split("\n").filter(line=>line.startsWith("{")).map(line=>JSON.parse(line)):[];
  report.lockObservations={sampleIntervalSeconds:0.05,samples:samples.length,
    maxGranted:samples.reduce((n,s)=>Math.max(n,s.locks.filter(l=>l.granted).length),0),
    maxWaiting:samples.reduce((n,s)=>Math.max(n,s.locks.filter(l=>!l.granted).length),0),
    caveat:"Sampling can miss fast locks; deliberate lock-timeout test and native server statement durations are separately retained.",
    nativeServerLog:"postgres.log",lockTimeout:"2s",statementTimeout:"60s"};
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(evidence,"report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({status:report.status,evidence,checks:report.checks.length,failure:report.failure??null}));
}
