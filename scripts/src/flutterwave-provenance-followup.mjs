// File/Git-only extension: never initializes or connects to PostgreSQL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeRehearsal, hash } from "./flutterwave-rehearsal/native.mjs";
import { scanProvenance } from "./flutterwave-rehearsal/provenance-scan.mjs";
if(process.argv.length!==2||Object.keys(process.env).some(k=>!["PATH","HOME","LANG","LC_ALL"].includes(k)))
  throw new Error("Clean environment only, no target or application options");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");process.chdir(root);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"fw-provenance-only-"));fs.chmodSync(directory,0o700);
const evidence=path.join(root,"generated-artifacts/flutterwave-readiness-followup",path.basename(directory));
fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const report={startedAt:new Date().toISOString(),commands:[],checks:[],noPostgresStarted:true,hold:true,
  ledgerQueried:false,ledgerModified:false,remoteFetched:false};
const runner=new NativeRehearsal(directory,evidence,report);
try {
  report.provenance=scanProvenance(runner,root);
  report.status=report.provenance.originalSourceRecovered?"EXACT_SOURCE_CANDIDATE_FOUND_HOLD":"SOURCE_NOT_FOUND_HOLD";
} catch(error) {report.status="INCOMPLETE_SEARCH_HOLD";report.failure=String(error.stack??error);process.exitCode=1;}
finally {
  fs.rmSync(directory,{recursive:true,force:true});report.temporaryDirectoryDeleted=!fs.existsSync(directory);
  report.finishedAt=new Date().toISOString();
  const text=JSON.stringify(report,null,2)+"\n";
  fs.writeFileSync(path.join(evidence,"report.json"),text);
  console.log(JSON.stringify({status:report.status,evidence,sha256:hash(text),
    candidates:report.provenance?.candidateCount,unreachableTrees:report.provenance?.unreachableTreeCount,failure:report.failure??null}));
}
