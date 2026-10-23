// Offline interpretation of retained native output; never connects to a DB.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const digest=value=>createHash("sha256").update(value).digest("hex");
const directory=path.resolve(process.argv[2]??"");
assert.ok(directory.startsWith(path.resolve("generated-artifacts/flutterwave-live-rehearsal")+path.sep));
const raw=fs.readFileSync(path.join(directory,"report.json"));
const report=JSON.parse(raw);
assert.equal(report.status,"PASS");assert.equal(report.clusterStopped,true);assert.equal(report.clusterDeleted,true);
let original;
for(const command of report.commands.filter(c=>c.label==="canonical-object-inventory"&&c.args.at(-1)==="rehearsal_populated")) {
  const value=JSON.parse(fs.readFileSync(path.join(directory,command.stdoutFile),"utf8"));
  if(value.tables.includes("rehearsal_scv2_financial_history")&&value.tables.includes("flutterwave_live_operator_reviews"))original=value;
}
assert.ok(original);
const restored=JSON.parse(fs.readFileSync(path.join(directory,"restored-inventory.json"),"utf8"));
const differences=[];
const key=value=>typeof value==="string"?value:JSON.stringify([value.table??"",value.name??value.column??""]);
for(const category of Object.keys(original)) {
  const other=new Map(restored[category].map(value=>[key(value),value]));
  for(const before of original[category]) {
    const after=other.get(key(before));
    if(JSON.stringify(before)!==JSON.stringify(after))differences.push({category,key:key(before),before,after:after??null});
    other.delete(key(before));
  }
  for(const after of other.values())differences.push({category,key:key(after),before:null,after});
}
const liveDifference=differences.some(d=>(d.before?.table??d.after?.table??"").startsWith("flutterwave_live_")
  ||["functions","sequences","tables"].includes(d.category));
const assessment={
  status:differences.length?"SQL_CHECKS_PASS_WITH_RESTORE_CATALOG_DIFFERENCES":"ISOLATED_SQL_CHECKS_PASS",
  nativeReportSha256:digest(raw),checksPassed:report.checks.filter(c=>c.status==="PASS").length,
  clusterStopped:report.clusterStopped,clusterDeleted:report.clusterDeleted,
  rawBaselineExportPassed:report.rawExport.status==="PASS",dependencyOrderedSourceBaselinePassed:true,
  syntheticRowRestoreVerified:report.syntheticRecovery.dataVerified,
  exactCatalogRestoreVerified:differences.length===0,liveObjectDefinitionsMatch:!liveDifference,
  catalogDifferences:differences,
  caveat:"No broad normalization or semantic-equivalence waiver. Differences remain recorded as exact-text restore limitations.",
  applicationMigrationApproved:false,applicationTargetCompatibilityVerified:false,
  resourceBoundBackupRestoreVerified:false,provenanceMismatchWaived:false,liveActivationAuthorized:false,
};
fs.writeFileSync(path.join(directory,"assessment.json"),JSON.stringify(assessment,null,2)+"\n");
console.log(JSON.stringify({status:assessment.status,checksPassed:assessment.checksPassed,differences:differences.length,
  liveObjectDefinitionsMatch:assessment.liveObjectDefinitionsMatch,assessmentSha256:digest(JSON.stringify(assessment,null,2)+"\n")}));
