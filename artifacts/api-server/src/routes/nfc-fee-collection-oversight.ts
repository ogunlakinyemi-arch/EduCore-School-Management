import { Router,type Request,type Response,type NextFunction } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuthentication,getUserContext } from "../middlewares/auth";
import { collectionStatuses,readNfcFeeCollectionOversight,readNfcFeeCollectionFilterOptions } from "../services/nfc-fee-collection-oversight";
const router=Router();
const positive=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
function requireOwner(req:Request,res:Response,next:NextFunction){
  res.setHeader("Cache-Control","no-store");
  const c=getUserContext(req);
  if(c.user.status!=="ACTIVE" || !c.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.schoolId===null&&r.status==="ACTIVE")){
    res.status(403).json({error:"Active global Platform Owner access required."});return;
  }
  next();
}
router.get("/platform/nfc-fee-collection-oversight/filter-options",requireAuthentication(),requireOwner,async(req,res)=>{
  const parsed=z.object({schoolId:positive.optional()}).strict().safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:"Invalid school filter."});return;}
  try{
    const options=await readNfcFeeCollectionFilterOptions(pool,parsed.data.schoolId);
    if(!options.schoolExists){res.status(400).json({error:"Selected school does not exist."});return;}
    res.json({schools:options.schools,terms:options.terms});
  }catch{res.status(503).json({error:"School and academic-term choices are temporarily unavailable."});}
});
router.get("/platform/nfc-fee-collection-oversight",requireAuthentication(),requireOwner,async(req,res)=>{
  const parsed=z.object({schoolId:positive.optional(),termId:positive.optional(),
    search:z.string().trim().max(100).optional(),status:z.enum(collectionStatuses).optional(),
    limit:positive.max(100).default(50),offset:z.coerce.number().int().min(0).max(1_000_000).default(0)}).strict().safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:"Invalid collection filters."});return;}
  try{
    if(parsed.data.termId!==undefined){
      const valid=(await pool.query(`SELECT EXISTS(SELECT 1 FROM academic_terms
        WHERE id=$1 AND ($2::int IS NULL OR school_id=$2)) AS valid`,
        [parsed.data.termId,parsed.data.schoolId??null])).rows[0]?.valid;
      if(!valid){res.status(400).json({error:"Select an existing academic term belonging to the selected school."});return;}
    }
    res.json(await readNfcFeeCollectionOversight(pool,parsed.data));
  }
  catch{res.status(503).json({error:"Fee collection oversight is temporarily unavailable. No payment status was changed."});}
});
export default router;
