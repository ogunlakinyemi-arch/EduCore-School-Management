// Narrow, explicitly disposable follow-up. No application runtime, DB URL,
// external provider, deployment operation or migration ledger import.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { NativeRehearsal, hash } from "./flutterwave-rehearsal/native.mjs";
import { splitSql, parseStatement } from "./schema-export/sql.mjs";
import { loadReview, reviewDrafts } from "./flutterwave-live-review.mjs";
import { verifyCheckSemantics } from "./flutterwave-rehearsal/check-semantics.mjs";
import { scanProvenance } from "./flutterwave-rehearsal/provenance-scan.mjs";

if(process.argv.length!==2||Object.keys(process.env).some(k=>!["PATH","HOME","LANG","LC_ALL"].includes(k)))
  throw new Error("Clean environment only; no target, credentials or application options accepted");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");process.chdir(root);
const pins=loadReview(root);assert.equal(reviewDrafts(pins.manifest,pins.sources).offlineReviewPassed,true);
const oldDirectory="generated-artifacts/flutterwave-live-rehearsal/edupulse-fw-pinned-cqd4Ug";
const old=JSON.parse(fs.readFileSync(path.join(oldDirectory,"report.json"),"utf8"));
const assessment=JSON.parse(fs.readFileSync(path.join(oldDirectory,"assessment.json"),"utf8"));
assert.equal(hash(fs.readFileSync(path.join(oldDirectory,"report.json"))),assessment.nativeReportSha256);
const raw=fs.readFileSync(path.join(oldDirectory,"source-model.raw.sql"),"utf8");
const ordered=fs.readFileSync(path.join(oldDirectory,"source-model.sql"),"utf8");
assert.equal(hash(raw),old.baseline.rawSha256);assert.equal(hash(ordered),old.baseline.orderedSha256);
const statements=splitSql(raw),orderedStatements=splitSql(ordered);
const multiset=items=>items.map(hash).sort();
assert.deepEqual(multiset(statements),multiset(orderedStatements));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"edupulse-fw-followup-"));fs.chmodSync(directory,0o700);
const evidence=path.join(root,"generated-artifacts/flutterwave-readiness-followup",path.basename(directory));
fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const report={startedAt:new Date().toISOString(),status:"RUNNING",commands:[],checks:[],
  input:{priorReportSha256:assessment.nativeReportSha256,rawSha256:hash(raw),orderedSha256:hash(ordered)},
  hold:true,applicationDatabaseConnected:false,applicationMigrationApproved:false,ledgerModified:false,
  secretsChanged:false,providerCalled:false,workersResumed:false,liveActivated:false,node:process.version};
const r=new NativeRehearsal(directory,evidence,report);
try {
  await r.start({encoding:"UTF8"});
  r.check(r.json("postgres","SELECT jsonb_build_object('encoding',current_setting('server_encoding'));").encoding==="UTF8","explicit UTF8 disposable server");
  for(const db of ["rehearsal_raw","rehearsal_ordered","rehearsal_key","rehearsal_check_original","rehearsal_check_restored"])r.create(db);
  const before=r.catalog("rehearsal_raw");
  r.sql("rehearsal_raw","BEGIN;\n"+raw+"\nCOMMIT;","unchanged-raw-export-reproduction","42830");
  r.equal(r.catalog("rehearsal_raw"),before,"raw export fails atomically, no partial schema");
  r.sql("rehearsal_ordered",ordered,"unchanged-dependency-ordered-baseline");
  const catalog=r.catalog("rehearsal_ordered");
  r.check(catalog.tables.length===187&&catalog.constraints.filter(c=>c.kind==="f").length===693
    &&catalog.constraints.every(c=>c.validated)&&catalog.indexes.every(i=>i.valid&&i.ready),"same-statement ordered export installs validated model");
  const fk=statements.find(s=>s.includes('ADD CONSTRAINT "staff_nfc_allocations_subscription_owner_term_fk"'));
  const index=statements.find(s=>s.startsWith('CREATE UNIQUE INDEX "staff_nfc_subscriptions_id_employee_school_term_uq"'));
  assert.ok(fk&&index);const parsed=parseStatement(fk);
  const parent=statements.find(s=>s.startsWith('CREATE TABLE "staff_nfc_subscriptions"'));
  const child=statements.find(s=>s.startsWith('CREATE TABLE "staff_nfc_allocations"'));
  assert.ok(parent&&child);
  report.rawCause={constraint:parsed.name,parent:parsed.parent,columns:parsed.parentColumns,
    rawFkStatement:statements.indexOf(fk)+1,rawSupportingIndexStatement:statements.indexOf(index)+1,
    orderedFkStatement:orderedStatements.indexOf(fk)+1,orderedSupportingIndexStatement:orderedStatements.indexOf(index)+1,
    originalForeignKeySql:fk,originalSupportingIndexSql:index,statementMultisetIdentical:true};
  r.check(statements.indexOf(fk)<statements.indexOf(index)&&orderedStatements.indexOf(index)<orderedStatements.indexOf(fk),
    "actual qualifying index exists in source but is emitted after dependent FK in raw order");
  r.sql("rehearsal_key",parent+"\n"+child,"actual-unaltered-parent-child-declarations");
  const keyBefore=r.catalog("rehearsal_key");
  r.sql("rehearsal_key",fk,"actual-FK-before-existing-key","42830");
  r.equal(r.catalog("rehearsal_key"),keyBefore,"failed standalone FK leaves catalog unchanged");
  r.sql("rehearsal_key",index+"\n"+fk,"actual-existing-index-before-same-FK");
  const keyCatalog=r.catalog("rehearsal_key");
  r.check(keyCatalog.constraints.some(c=>c.name===parsed.name&&c.supportingIndex==="staff_nfc_subscriptions_id_employee_school_term_uq"&&c.validated),
    "same original FK succeeds and binds same original unique index after ordering only");
  report.semantics=verifyCheckSemantics(r,statements,assessment);
  report.provenance=scanProvenance(r,root);
  const final=loadReview(root);
  r.check(JSON.stringify(final.manifest)===JSON.stringify(pins.manifest)&&reviewDrafts(final.manifest,final.sources).offlineReviewPassed,
    "original eight SQL pins and review manifest unchanged");
  report.status="ISOLATED_FINDINGS_VERIFIED_HOLD";
} catch(error) { report.status="FAIL_HOLD";report.failure=String(error.stack??error);process.exitCode=1; }
finally {
  await r.close();report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(evidence,"report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({status:report.status,evidence,checks:report.checks.length,failure:report.failure??null}));
}
