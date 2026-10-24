import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { assertRoles, requireAuthentication, AuthError, getUserContext } from "../middlewares/auth";
import { assignCapturedUid } from "../services/uid-inventory-assignment";
import { issueReplacement, requestReplacement } from "../services/student-card-replacement";
import { markSecurityCardLost } from "../services/school-security-core-service";

const router = Router();
const positive = z.number().int().positive().max(2147483647);
const confirmed = z.object({ confirm:z.literal(true) });
const run = (fn:(req:Request,res:Response)=>Promise<void>) =>
  (req:Request,res:Response,next:NextFunction) => void fn(req,res).catch(next);
router.use(requireAuthentication());
router.get("/platform/schools/:schoolId/card-brand",run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);
  const schoolId=positive.parse(Number(req.params.schoolId));
  const rows=await pool.query(`SELECT metadata FROM audit_logs WHERE school_id=$1
    AND action='Official card brand configured' AND module='Cards' ORDER BY id DESC LIMIT 1`,[schoolId]);
  res.json({primaryColor:rows.rows[0]?.metadata.primaryColor??null,secondaryColor:rows.rows[0]?.metadata.secondaryColor??null});
}));
router.put("/platform/schools/:schoolId/card-brand",run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);
  const schoolId=positive.parse(Number(req.params.schoolId));
  const b=z.object({primaryColor:z.string().regex(/^#[a-fA-F0-9]{6}$/),secondaryColor:z.string().regex(/^#[a-fA-F0-9]{6}$/)}).parse(req.body);
  if(!(await pool.query("SELECT id FROM schools WHERE id=$1",[schoolId])).rows[0]) throw new AuthError(404,"School not found");
  if(b.primaryColor.toLowerCase()===b.secondaryColor.toLowerCase()) throw new AuthError(400,"Choose distinct primary and secondary school colors");
  await pool.query(`INSERT INTO audit_logs("user",role,actor_user_id,school_id,action,module,record_id,event_type,result,metadata)
    VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,'Official card brand configured','Cards',$2,'OFFICIAL_CARD_BRAND','SUCCESS',$3::jsonb)`,
    [getUserContext(req).user.id,schoolId,JSON.stringify(b)]);
  res.json(b);
}));
router.post("/platform/uid-inventory/assign",run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);
  const b=confirmed.extend({uid:z.string(),schoolId:positive,studentId:positive}).parse(req.body);
  res.status(201).json(await assignCapturedUid(req,b.schoolId,b.studentId,b.uid));
}));
router.post("/platform/uid-inventory/cards/:cardId/unlink",run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);
  const cardId=positive.parse(Number(req.params.cardId));
  const b=confirmed.extend({kind:z.enum(["LOST","DAMAGED"]),reason:z.string().trim().min(3).max(480)}).parse(req.body);
  const card=(await pool.query(`SELECT id,school_id,student_id,uid,status,replaced_by_card_id FROM nfc_cards WHERE id=$1`,[cardId])).rows[0];
  if(!card) throw new AuthError(404,"Card not found");
  if(card.replaced_by_card_id!=null || !["active","locked","lost","blocked","inactive","suspended"].includes(card.status))
    throw new AuthError(409,"This card cannot be unlinked for replacement");
  const reason=`${b.kind}: ${b.reason}`;
  // Revocation commits independently, even if invoice creation subsequently fails.
  await markSecurityCardLost(req,card.school_id,cardId,reason,card.student_id??undefined);
  await pool.query(`INSERT INTO audit_logs("user",role,actor_user_id,school_id,action,module,record_id,event_type,result,metadata)
    VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,'Owner confirmed card unlink','Cards',$3,'OWNER_CARD_UNLINKED','SUCCESS',$4::jsonb)`,
    [getUserContext(req).user.id,card.school_id,cardId,JSON.stringify({oldCardId:cardId,oldUid:card.uid,studentId:card.student_id,kind:b.kind,reason:b.reason,previousStatus:card.status,newStatus:"lost",confirmed:true})]);
  if(card.student_id==null) {
    res.json({cardId,uid:card.uid,status:"lost",requiresSchoolAdminRequest:true,
      message:"Old UID revoked. The School Admin must request/pay the employee replacement before Owner issuance."});
    return;
  }
  res.json(await requestReplacement(req,cardId,reason));
}));
router.post("/platform/uid-inventory/replacements/:requestId/issue",run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);
  const b=confirmed.extend({uid:z.string()}).parse(req.body);
  res.json(await issueReplacement(req,positive.parse(Number(req.params.requestId)),b.uid,true));
}));
router.use((e:any,_req:Request,res:Response,next:NextFunction)=>{
  if(e instanceof z.ZodError) {res.status(400).json({error:"Valid selection, explicit confirmation and a non-empty reason where applicable are required"});return;}
  next(e);
});
export default router;
