// Configuration-only by default. No provider requests or mutation commands.
// Optional target SELECTs require an explicit operator opt-in; never run at startup.
import { liveReleaseConfiguration,requireLiveRelease } from "../../artifacts/api-server/src/lib/flutterwave-live-release.ts";
const allowed=new Set(["--check-target"]);
if(process.argv.slice(2).some(arg=>!allowed.has(arg))){
  console.error("Usage: tsx src/flutterwave-live-runtime-release-check.mjs [--check-target]");
  process.exitCode=2;
}else{
  const config=liveReleaseConfiguration();
  let ready=config.ready,blockers=[...config.blockers],targetChecked=false;
  if(process.argv.includes("--check-target")&&ready){
    const {pool}=await import("@workspace/db");
    try{await requireLiveRelease(pool);targetChecked=true;}
    catch{ready=false;blockers.push("TARGET_SCHEMA_OR_RELEASE_APPROVAL");}
    finally{await pool.end();}
  }
  console.log(JSON.stringify({ready,blockers,targetChecked,providerRequestsMade:false,
    schoolReadiness:"REQUIRES_REVIEWED_LIVE_SUBACCOUNT",
    allocationReadiness:"REQUIRES_TRANSACTION_BOUND_PROVIDER_REPORT"},null,2));
  if(!ready)process.exitCode=1;
}
