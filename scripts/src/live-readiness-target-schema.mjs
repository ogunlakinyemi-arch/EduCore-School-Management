// Offline-only representative target export. No DB client/config import.
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {inspectModel} from "./schema-export/model.mjs";
import {orderExport} from "./schema-export/graph.mjs";
import {requiredTenantKeys,verifyRequiredTenantKeys} from "./schema-export/required-tenant-keys.mjs";
import {auditOutputPath} from "./export-dependency-aware-schema.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const digest=value=>createHash("sha256").update(value).digest("hex");
export async function exportLiveRehearsalTarget(output) {
  const destination=auditOutputPath(output),directory=path.join(root,"lib/db/src/schema");
  const fingerprint=()=>digest(fs.readdirSync(directory,{recursive:true}).filter(p=>p.endsWith(".ts")).sort()
    .map(p=>p+"\0"+digest(fs.readFileSync(path.join(directory,p)))).join("\n"));
  const sourceBefore=fingerprint();
  const result=spawnSync(process.execPath,[path.join(root,"lib/db/node_modules/drizzle-kit/bin.cjs"),
    "export","--dialect","postgresql","--schema","./src/schema/index.ts"],{
    cwd:path.join(root,"lib/db"),encoding:"utf8",maxBuffer:16*1024*1024,
    env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8"},
  });
  if(result.status!==0)throw new Error("Offline target export failed");
  const model=await inspectModel(root),plan=orderExport(result.stdout,model);
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
  if(fingerprint()!==sourceBefore)throw new Error("Schema source changed during export");
  const ordered=plan.statements.join("\n\n")+"\n";
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,ordered);
  fs.writeFileSync(destination+".raw.sql",result.stdout);
  const manifest={representativeOnly:true,applicationTargetVerified:false,sourceSha256:sourceBefore,
    rawSha256:digest(result.stdout),orderedSha256:digest(ordered),
    statementMultisetSha256:plan.rawStatementMultisetSha256,statements:plan.statementCount,
    tables:model.tables.length,foreignKeys:plan.foreignKeys.length,historicalOwnershipGuard,keyOwnership};
  fs.writeFileSync(destination+".json",JSON.stringify(manifest,null,2)+"\n");
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4||process.argv[2]!=="--out")throw new Error("Use --out /tmp/rehearsal.sql; export only");
  console.log(JSON.stringify(await exportLiveRehearsalTarget(process.argv[3])));
}
