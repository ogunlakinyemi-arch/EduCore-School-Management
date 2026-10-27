import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {pool} from "@workspace/db";
import {databaseReadiness} from "../services/database-readiness";

const router: IRouter = Router();
let probe:Promise<Awaited<ReturnType<typeof databaseReadiness>>>|undefined;
let checkedAt=0;
let probing=false;
function readiness(){
  if(!probe||(!probing&&Date.now()-checkedAt>2000)){
    probing=true;
    probe=databaseReadiness(pool).finally(()=>{probing=false;checkedAt=Date.now();});
  }
  return probe;
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});
// Liveness stays cheap and separate. This probe actually acquires and reads the
// application's DB connection; public failures reveal no credentials or topology.
router.get("/readyz", async(_req,res)=>{
  res.set("Cache-Control","no-store");
  const result=await readiness();
  res.status(result.ready?200:503).json({ready:result.ready,dependency:"database"});
});

export default router;
