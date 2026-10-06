import {Router,type Request,type Response,type NextFunction} from "express";
import {z} from "zod";
import {pool} from "@workspace/db";
import {AuthError,assertRoles,getUserContext,requireAuthentication} from "../middlewares/auth";
import {assignAvailableStudentCard} from "../services/student-card-assignment";
import {nfcAudit,partnerNfcIdentity,partnerNfcSchool} from "../services/partner-nfc-access";

const router=Router();
const run=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{fn(req,res).catch(next);};
const numeric=z.coerce.number().int().positive();
const permissionInput=z.object({enabled:z.boolean()}).strict();
const assignmentInput=z.object({studentId:z.number().int().positive(),cardNumber:z.string().trim().min(4).max(100).regex(/^[a-zA-Z0-9:_-]+$/)}).strict();
const filters=z.object({search:z.string().trim().max(120).optional(),className:z.string().trim().max(120).optional(),
  limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0)}).strict();
const cardFilters=filters.omit({className:true});
function parse<T>(schema:z.ZodType<T>,input:unknown):T{
  const r=schema.safeParse(input);if(!r.success)throw new AuthError(400,"Invalid NFC request; only documented fields are allowed");return r.data;
}
function noQuery(req:Request){if(Object.keys(req.query).length)throw new AuthError(400,"Unexpected query parameters");}
router.use("/partner/nfc",requireAuthentication());
router.use("/partners/:partnerId/nfc-permission",requireAuthentication());
router.use("/partner/staff/:userId/nfc-permission",requireAuthentication());
async function transaction<T>(fn:(c:{query(sql:string,values?:any[]):Promise<{rows:any[]}>})=>Promise<T>){
  const c=await pool.connect();try{await c.query("BEGIN");await c.query("SET LOCAL lock_timeout='5s'");const r=await fn(c);await c.query("COMMIT");return r;
  }catch(e:any){await c.query("ROLLBACK");if(["23505","40P01","55P03","57014"].includes(e.code))throw new AuthError(409,"A concurrent NFC change is in progress; refresh and retry");throw e;}finally{c.release();}
}
async function permissionState(partnerId:number,db=pool){
  const p=await db.query('SELECT id AS "partnerId",nfc_activation_enabled AS enabled FROM partner_profiles WHERE id=$1',[partnerId]);
  if(!p.rows[0])throw new AuthError(404,"Partner not found");
  const history=await db.query(`SELECT id,actor_user_id AS "actorUserId","user" AS "actorName",action,timestamp AS "createdAt",metadata
    FROM audit_logs WHERE module='Partner NFC Activation' AND event_type='PARTNER_NFC_PERMISSION_CHANGED' AND record_id=$1 ORDER BY id DESC LIMIT 50`,[partnerId]);
  return{...p.rows[0],history:history.rows.map(r=>({...r,previousValue:r.metadata?.previousValue,newValue:r.metadata?.newValue,metadata:undefined}))};
}
router.get("/partners/:partnerId/nfc-permission",run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);noQuery(req);res.json(await permissionState(parse(numeric,req.params.partnerId)));
}));
router.patch("/partners/:partnerId/nfc-permission",run(async(req,res)=>{
  assertRoles(req,["PLATFORM_OWNER"]);noQuery(req);const partnerId=parse(numeric,req.params.partnerId),{enabled}=parse(permissionInput,req.body);
  await transaction(async c=>{
    const old=await c.query('SELECT nfc_activation_enabled AS enabled,status FROM partner_profiles WHERE id=$1 FOR UPDATE',[partnerId]);
    if(!old.rows[0])throw new AuthError(404,"Partner not found");
    if(enabled&&old.rows[0].status!=="ACTIVE")throw new AuthError(409,"Activate the Partner account before granting NFC permission");
    await c.query("UPDATE partner_profiles SET nfc_activation_enabled=$1 WHERE id=$2",[enabled,partnerId]);
    await nfcAudit(req,c,"PARTNER_NFC_PERMISSION_CHANGED",partnerId,{partnerId,actorType:"Platform Owner",previousValue:old.rows[0].enabled,newValue:enabled});
  });
  res.json(await permissionState(partnerId));
}));
router.get("/partner/nfc/access",run(async(req,res)=>{
  noQuery(req);const a=await partnerNfcIdentity(req,pool,false,false);res.json({partnerId:a.partnerId,enabled:a.enabled,partnerEnabled:a.partnerEnabled,actorType:a.actorType,canManageStaff:a.isOwner});
}));
router.get("/partner/nfc/schools",run(async(req,res)=>{
  noQuery(req);const a=await partnerNfcIdentity(req);
  const r=await pool.query(`SELECT s.id AS "schoolId",s.name AS "schoolName",s.code AS "schoolCode",s.status,
      (SELECT count(*)::int FROM platform_devices d WHERE d.school_id=s.id AND upper(d.status)='ACTIVE'
        AND upper(d.device_type) IN ('NFC','HYBRID') AND d.configuration_status='CONFIGURED'
        AND EXISTS(SELECT 1 FROM device_school_bindings b WHERE b.device_id=d.id AND b.school_id=s.id)) AS "activeDeviceCount"
    FROM school_partner_attributions a JOIN schools s ON s.id=a.school_id
    WHERE a.partner_profile_id=$1 AND a.is_current=true AND a.status IN ('ACTIVE','CONFIRMED') ORDER BY s.name,s.id`,[a.partnerId]);
  res.json(r.rows.map(s=>({...s,eligible:String(s.status).toUpperCase()==="ACTIVE"&&s.activeDeviceCount>0,
    unavailableReason:String(s.status).toUpperCase()!=="ACTIVE"?"School account is inactive":s.activeDeviceCount>0?null:
    "NFC card activation is unavailable because no active NFC device has been linked to this school by the Platform Owner."})));
}));
router.get("/partner/nfc/schools/:schoolId/students",run(async(req,res)=>{
  const schoolId=parse(numeric,req.params.schoolId),f=parse(filters,req.query);
  await partnerNfcSchool(req,schoolId);
  const r=await pool.query(`SELECT s.id AS "studentId",s.admission_no AS "admissionNo",s.first_name AS "firstName",
    s.middle_name AS "middleName",s.last_name AS "lastName",s.class_name AS "className",s.section
    FROM students s WHERE s.school_id=$1 AND upper(s.status)='ACTIVE'
      AND ($2::text IS NULL OR concat_ws(' ',s.first_name,s.middle_name,s.last_name,s.admission_no) ILIKE '%'||$2||'%')
      AND ($3::text IS NULL OR s.class_name=$3)
      AND NOT EXISTS(SELECT 1 FROM nfc_cards nc WHERE nc.school_id=s.school_id AND nc.student_id=s.id AND lower(nc.status) IN ('active','locked','lost'))
    ORDER BY s.last_name,s.first_name,s.id LIMIT $4 OFFSET $5`,[schoolId,f.search??null,f.className??null,f.limit,f.offset]);
  res.json(r.rows);
}));
router.get("/partner/nfc/schools/:schoolId/cards",run(async(req,res)=>{
  const schoolId=parse(numeric,req.params.schoolId),f=parse(cardFilters,req.query);await partnerNfcSchool(req,schoolId);
  const r=await pool.query(`SELECT nc.id AS "cardId",nc.uid AS "cardNumber",nc.status FROM nfc_cards nc
    WHERE nc.school_id=$1 AND nc.student_id IS NULL AND lower(nc.status)='unassigned'
      AND ($2::text IS NULL OR nc.uid ILIKE '%'||$2||'%')
      AND NOT EXISTS(SELECT 1 FROM employee_nfc_card_bindings b WHERE b.nfc_card_id=nc.id)
    ORDER BY nc.id LIMIT $3 OFFSET $4`,[schoolId,f.search??null,f.limit,f.offset]);res.json(r.rows);
}));
router.post("/partner/nfc/schools/:schoolId/assign",run(async(req,res)=>{
  noQuery(req);const schoolId=parse(numeric,req.params.schoolId),input=parse(assignmentInput,req.body);
  const result=await transaction(async c=>{
    const a=await partnerNfcSchool(req,schoolId,c,true);
    const assigned=await assignAvailableStudentCard(c,{schoolId,...input,allowCreate:false});
    const {card,student,previousStatus}=assigned;
    await c.query(`INSERT INTO nfc_card_history(school_id,nfc_card_id,student_id,action,previous_status,new_status,reason,actor_user_id)
      VALUES($1,$2,$3,'ASSIGNED',$4,$5,$6,$7)`,[schoolId,card.id,input.studentId,previousStatus,card.status,
      "Partner assignment; staged lifecycle and subscription prerequisites retained",a.context.user.id]);
    await nfcAudit(req,c,"PARTNER_NFC_CARD_ASSIGNED",card.id,{
      actorType:a.actorType,partnerId:a.partnerId,schoolId,studentId:input.studentId,cardId:card.id,cardNumber:card.uid,
      previousStudentId:null,previousStatus,newStatus:card.status,permissionEnabled:true,activeDeviceCount:a.activeDeviceIds.length,
      readerEligibility:"ACTIVE CONFIGURED NFC/HYBRID with authoritative school binding",unlocked:false},schoolId);
    return{schoolId,schoolName:a.school.name,studentId:student.id,studentName:[student.firstName,student.middleName,student.lastName].filter(Boolean).join(" "),
      admissionNo:student.admissionNo,className:student.className,section:student.section,cardId:card.id,cardNumber:card.uid,status:card.status,
      message:"Card assigned. Existing activation, subscription and replacement controls still apply; this permission does not unlock the card."};
  });
  res.status(201).json(result);
}));
router.patch("/partner/staff/:userId/nfc-permission",run(async(req,res)=>{
  noQuery(req);const userId=parse(numeric,req.params.userId),{enabled}=parse(permissionInput,req.body);
  const result=await transaction(async c=>{
    // Lock the Partner before staff, matching assignment lock order.
    const a=await partnerNfcIdentity(req,c,false,false);
    if(!a.isOwner||getUserContext(req).user.id===userId)throw new AuthError(403,"Only the primary Partner can authorize other Partner staff");
    const p=await c.query("SELECT nfc_activation_enabled AS enabled FROM partner_profiles WHERE id=$1 AND status='ACTIVE' FOR UPDATE",[a.partnerId]);
    if(!p.rows[0])throw new AuthError(403,"Partner is inactive");
    if(enabled&&!p.rows[0].enabled)throw new AuthError(403,"Platform Owner NFC permission is required before authorizing staff");
    const old=await c.query(`SELECT id,nfc_activation_enabled AS enabled FROM partner_profile_users WHERE partner_profile_id=$1 AND user_id=$2
      AND status='ACTIVE' AND role IN ('PARTNER_STAFF','PARTNER_ADMIN','PARTNER_FINANCE') FOR UPDATE`,[a.partnerId,userId]);
    if(!old.rows[0])throw new AuthError(404,"Active Partner staff member not found");
    await c.query("UPDATE partner_profile_users SET nfc_activation_enabled=$1 WHERE id=$2",[enabled,old.rows[0].id]);
    await nfcAudit(req,c,"PARTNER_STAFF_NFC_PERMISSION_CHANGED",userId,{actorType:"Partner",partnerId:a.partnerId,staffUserId:userId,previousValue:old.rows[0].enabled,newValue:enabled,partnerPermissionEnabled:p.rows[0].enabled});
    return{userId,enabled};
  });res.json(result);
}));
export default router;
