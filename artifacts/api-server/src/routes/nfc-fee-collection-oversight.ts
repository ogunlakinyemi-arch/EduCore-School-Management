import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuthentication,getUserContext } from "../middlewares/auth";
import { collectionStatuses,readNfcFeeCollectionOversight } from "../services/nfc-fee-collection-oversight";
const router=Router();
router.get("/platform/nfc-fee-collection-oversight",requireAuthentication(),async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const c=getUserContext(req);
  if(c.user.status!=="ACTIVE" || !c.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.schoolId===null&&r.status==="ACTIVE")){
    res.status(403).json({error:"Active global Platform Owner access required."});return;
  }
  const positive=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const parsed=z.object({schoolId:positive.optional(),termId:positive.optional(),
    search:z.string().trim().max(100).optional(),status:z.enum(collectionStatuses).optional(),
    limit:positive.max(100).default(50),offset:z.coerce.number().int().min(0).max(1_000_000).default(0)}).strict().safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:"Invalid collection filters."});return;}
  try{res.json(await readNfcFeeCollectionOversight(pool,parsed.data));}
  catch{res.status(503).json({error:"Fee collection oversight is temporarily unavailable. No payment status was changed."});}
});
export default router;
