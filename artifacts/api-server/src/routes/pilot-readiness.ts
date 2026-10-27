import {Router} from "express";
import {pool} from "@workspace/db";
import {requireAuthentication,getUserContext} from "../middlewares/auth";
import {readPilotCalendars} from "../services/pilot-readiness";
import {databaseReadiness} from "../services/database-readiness";
export const router=Router();
router.get("/platform/pilot-readiness",requireAuthentication(),async(req,res)=>{
  res.set("Cache-Control","private, no-store");
  const actor=getUserContext(req);
  if(actor.user.status!=="ACTIVE"||!actor.roles.some(r=>r.status==="ACTIVE"&&r.role==="PLATFORM_OWNER"&&r.schoolId===null)
    ||actor.roles.some(r=>r.status==="ACTIVE"&&["DEVICE_ACTIVATION_OFFICER","COMPANY_ACCOUNTANT"].includes(r.role))){
    res.status(403).json({error:"ACTIVE_GLOBAL_OWNER_REQUIRED"});return;
  }
  const database=await databaseReadiness(pool);
  const poolCounts={total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount};
  if(!database.ready){res.status(503).json({error:"DATABASE_NOT_READY",database,poolCounts});return;}
  try{
    res.json({checkedAt:new Date().toISOString(),productionChangeAllowed:false,
      database,poolCounts,configurationTargetFingerprint:pool.targetDiagnostic.targetFingerprint,
      targetBindingVerified:false,recoveryVerified:false,
      calendars:await readPilotCalendars(pool),
      blockers:["VERIFY_SERVING_PRODUCTION_PRIMARY_AND_RECOVERY","REVIEW_EXACT_SCHEMA_DIFF_AND_ROLLBACK",
        "VERIFY_AUTHENTICATED_PRODUCTION_ACCEPTANCE"],
    });
  }catch{res.status(503).json({error:"PILOT_CALENDAR_REVIEW_UNAVAILABLE",productionChangeAllowed:false});}
});
export default router;
