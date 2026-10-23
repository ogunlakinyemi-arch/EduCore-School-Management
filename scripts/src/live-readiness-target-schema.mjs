// Offline-only representative target export. No DB client/config import.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {captureOrderedExport} from "./schema-export/source.mjs";
import {requiredTenantKeys,verifyRequiredTenantKeys} from "./schema-export/required-tenant-keys.mjs";
import {auditOutputPath} from "./export-dependency-aware-schema.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const digest=value=>createHash("sha256").update(value).digest("hex");
export async function exportLiveRehearsalTarget(output) {
  const destination=auditOutputPath(output);
  const {model,plan,rawEvidenceSql,orderedSql:ordered,sourceHashes}=await captureOrderedExport(root);
  // Preserve the existing fingerprint algorithm for evidence comparability.
  const sourceBefore=digest(Object.entries(sourceHashes).map(([p,h])=>p+"\0"+h).join("\n"));
  // Current ownership is checked strictly; historical ownership stays explicit.
  let historicalOwnershipGuard="PASS";
  try{verifyRequiredTenantKeys(model);}catch(error){historicalOwnershipGuard=error.message;}
  const keyOwnership=requiredTenantKeys.map(required=>{
    const key=model.tables.find(t=>t.id===required.table)?.keys.find(k=>k.name===required.name);
    if(!key||JSON.stringify([...key.columns].sort())!==JSON.stringify([...required.columns].sort()))
      throw new Error("Representative target missing required tenant key: "+required.name);
    return {table:required.table,name:required.name,expectedKind:required.kind,actualKind:key.kind,
      historicalKind:required.historicalKind??required.kind};
  });
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,ordered);
  fs.writeFileSync(destination+".raw.sql",rawEvidenceSql);
  const manifest={representativeOnly:true,applicationTargetVerified:false,sourceSha256:sourceBefore,
    rawSha256:digest(rawEvidenceSql),orderedSha256:digest(ordered),rawEvidenceExecutable:false,
    statementMultisetSha256:plan.rawStatementMultisetSha256,statements:plan.statementCount,
    tables:model.tables.length,foreignKeys:plan.foreignKeys.length,historicalOwnershipGuard,keyOwnership};
  fs.writeFileSync(destination+".json",JSON.stringify(manifest,null,2)+"\n");
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4||process.argv[2]!=="--out")throw new Error("Use --out /tmp/rehearsal.sql; export only");
  console.log(JSON.stringify(await exportLiveRehearsalTarget(process.argv[3])));
}
