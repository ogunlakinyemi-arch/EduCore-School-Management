import {Router,type Request} from "express";
import {z} from "zod";
import {pool} from "@workspace/db";
import {AuthError,getUserContext,requireAuthentication} from "../middlewares/auth";
import {getTelegramHealth,diagnoseTelegramBot} from "../services/telegram-provider";
import {eligibleTelegramParent,telegramSchoolAllowed,createParentTelegramChallenge,
  confirmParentTelegramLink,revokeParentTelegramLink,openTelegramChat,telegramPhoneCheck,isAdminTelegramInvitation} from "../services/telegram-links";
import {parentTelegramInvitationStatus,telegramDirectoryParent,createTelegramDirectoryInvitation} from "../services/telegram-onboarding";
import {dispatchCommunicationDeliveries} from "../services/communication-service";
import {logger} from "../lib/logger";
import {inspectTelegramStorage} from "../services/telegram-storage-readiness";
const router=Router();
router.use(requireAuthentication());
const run=(fn:(req:Request,res:any)=>Promise<void>)=>(req:Request,res:any,next:any)=>{void fn(req,res).catch(e=>{
  if(e instanceof z.ZodError)return res.status(400).json({error:"Invalid Telegram request"});
  if(e?.code==="23505")return res.status(409).json({error:"This Telegram account is already linked. Unlink it before linking another parent."});
  if(e instanceof AuthError)return next(e);
  res.status(503).json({error:"Telegram temporarily unavailable"});
});};
const isOwner=(req:Request)=>getUserContext(req).roles.some(r=>r.role==="PLATFORM_OWNER"&&r.status==="ACTIVE");
function parentSession(req:Request){
  const ctx=getUserContext(req);
  if(isOwner(req)||!ctx.roles.some(r=>r.role==="PARENT"&&r.status==="ACTIVE"))throw new AuthError(403,"Authenticated parent only");
  return ctx.user.id;
}
function sameOrigin(req:Request){
  const permitted=(process.env.REPLIT_DOMAINS??process.env.REPLIT_DEV_DOMAIN??"").split(",").map(x=>x.trim()).filter(Boolean);
  if(process.env.NODE_ENV==="test")permitted.push(req.get("host")??"");
  try{
    const origin=new URL(req.get("Origin")??"");
    const published=(process.env.EDUCORE_TELEGRAM_ALLOWED_ORIGINS??"").split(",").map(x=>x.trim()).filter(Boolean);
    if(origin.protocol==="https:"&&published.includes(origin.origin))return;
    if(permitted.includes(origin.host))return;
  }catch{}
  throw new AuthError(403,"Open Telegram controls from the EduCore app");
}
async function audit(db:any,userId:number,schoolId:number|null,event:string,metadata:Record<string,unknown>={}){
  await db.query(`INSERT INTO audit_logs(actor_user_id,"user",role,school_id,action,module,event_type,result,metadata)
    SELECT id,email,$4,$2,$3,'Communication',$3,'SUCCESS',$5::jsonb FROM app_users WHERE id=$1`,
    [userId,schoolId,event,event==="TELEGRAM_CONFIGURATION_CHECK"?"PLATFORM_OWNER":
      event==="TELEGRAM_PARENT_INVITED"?"SCHOOL_ADMIN":"PARENT",JSON.stringify(metadata)]);
}
async function transaction(userId:number,fn:(db:any)=>Promise<any>){
  const db=await pool.connect();
  try{await db.query("BEGIN");await db.query("SELECT pg_advisory_xact_lock(31972,$1)",[userId]);
    const result=await fn(db);await db.query("COMMIT");return result;
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
router.get("/status",run(async(req,res)=>{
  const {schoolId}=z.object({schoolId:z.coerce.number().int().positive().optional()}).strict().parse(req.query);
  const h=getTelegramHealth(),{botId:_botId,...safe}=h,userId=getUserContext(req).user.id;
  let eligible=false,parent:any=null;
  if(schoolId&&!isOwner(req)&&getUserContext(req).roles.some(r=>r.role==="PARENT"&&r.status==="ACTIVE")){
    parent=await eligibleTelegramParent(pool,userId,schoolId);eligible=!!parent;
  }
  // Own account revocation stays available after relationships/health are withdrawn.
  const own=isOwner(req)?null:(await pool.query("SELECT id FROM parents WHERE user_id=$1",[userId])).rows[0];
  const link=own?(await pool.query(`SELECT consented_at,bot_id,chat_ciphertext FROM parent_telegram_links WHERE parent_id=$1`,[own.id])).rows[0]:null;
  const pending=parent&&h.ready?(await pool.query(`SELECT pending_ciphertext,token_hash FROM telegram_link_challenges WHERE parent_id=$1
    AND school_id=$2 AND bot_id=$3 AND expires_at>now() AND claimed_at IS NOT NULL AND confirmed_at IS NULL
    AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`,[parent.id,schoolId,h.botId])).rows[0]:null;
  let label=null,phoneCheck:null|"MATCH"|"MISMATCH"=null;
  try{if(pending){const binding=openTelegramChat(parent.id,pending.pending_ciphertext);label=binding.label;
    phoneCheck=await telegramPhoneCheck(pool,parent.id,binding);}}catch{}
  const context=parent?(await pool.query(`SELECT school.name AS "schoolName",
    array_agg(DISTINCT trim(concat(s.first_name,' ',s.last_name))) AS children
    FROM parents p JOIN parent_student_relationships r ON r.parent_id=p.id AND upper(r.status)='ACTIVE'
    JOIN students s ON s.id=r.student_id AND s.school_id=$2 AND upper(s.status)='ACTIVE'
    JOIN schools school ON school.id=s.school_id WHERE p.id=$1 GROUP BY school.name`,[parent.id,schoolId])).rows[0]:null;
  const invitationOnly=!!pending&&await isAdminTelegramInvitation(pool,pending.token_hash);
  let linked=false;
  try{if(link?.consented_at&&link.bot_id===h.botId&&own){openTelegramChat(own.id,link.chat_ciphertext);linked=true;}}catch{}
  res.set("Cache-Control","no-store").json({...safe,linked,consented:!!link?.consented_at,
    parentEligible:eligible,policyAllowed:!!schoolId&&await telegramSchoolAllowed(pool,schoolId),
     pending:!!label,pendingAccountLabel:invitationOnly?null:label,schoolName:context?.schoolName??null,children:context?.children??[],
     phoneCheck:invitationOnly?null:phoneCheck,invitationOnly});
}));
let lastOwnerCheck=0;
router.post("/health",run(async(req,res)=>{
  if(!isOwner(req))throw new AuthError(403,"Platform Owner only");
  sameOrigin(req);
  if(Date.now()-lastOwnerCheck<10000){res.status(429).json({error:"Wait ten seconds before checking again"});return;}
  lastOwnerCheck=Date.now();
   const storage=await inspectTelegramStorage(pool);
   const diagnostic=await diagnoseTelegramBot();
   const {botId:_botId,...cachedDelivery}=getTelegramHealth();
   // A fresh failed storage gate can only reduce readiness, never enable it.
   // Successful catalog inspection is not a bot check or send authorization.
   const delivery=storage.ready?cachedDelivery:{...cachedDelivery,ready:false,reason:"SCHEMA_NOT_READY"};
  try{
    await audit(pool,getUserContext(req).user.id,null,"TELEGRAM_CONFIGURATION_CHECK",{
      diagnosticOk:diagnostic.diagnosticOk,diagnosticReason:diagnostic.diagnosticReason,
      deliveryReady:delivery.ready,deliveryReason:delivery.reason,
    });
  }catch{
    logger.warn({event:"TELEGRAM_HEALTH_CHECK_FAILED",reason:"CHECK_AUDIT_UNAVAILABLE"},"Telegram check audit unavailable");
    res.status(503).set("Cache-Control","no-store").json({error:"Telegram check audit unavailable",reason:"CHECK_AUDIT_UNAVAILABLE"});return;
  }
   res.set("Cache-Control","no-store").json({...delivery,...diagnostic,storageReady:storage.ready,storageMissing:storage.missing,
     linked:false,consented:false,parentEligible:false,
    policyAllowed:false,pending:false,pendingAccountLabel:null});
}));
router.post("/link",run(async(req,res)=>{
  sameOrigin(req);const userId=parentSession(req);
  const q=z.object({schoolId:z.number().int().positive(),consent:z.literal(true)}).strict().parse(req.body);
  const result=await transaction(userId,async db=>{
    const result=await createParentTelegramChallenge(db,userId,q.schoolId);
    await audit(db,userId,q.schoolId,"TELEGRAM_LINK_REQUESTED");return result;
  });
  res.set("Cache-Control","no-store").json(result);
}));
router.post("/link/confirm",run(async(req,res)=>{
  sameOrigin(req);const userId=parentSession(req);
  const q=z.object({schoolId:z.number().int().positive(),consent:z.literal(true)}).strict().parse(req.body);
  await transaction(userId,async db=>{
    await confirmParentTelegramLink(db,userId,q.schoolId);
    await audit(db,userId,q.schoolId,"TELEGRAM_ACCOUNT_LINKED");
  });
  res.set("Cache-Control","no-store").json({linked:true});
}));
router.delete("/link",run(async(req,res)=>{
  sameOrigin(req);const userId=getUserContext(req).user.id;
  await transaction(userId,async db=>{
    await revokeParentTelegramLink(db,userId);await audit(db,userId,null,"TELEGRAM_CONSENT_WITHDRAWN");
  });
  res.set("Cache-Control","no-store").json({unlinked:true});
}));
function schoolAdmin(req:Request,schoolId:number){
  if(isOwner(req)||!getUserContext(req).roles.some(r=>r.role==="SCHOOL_ADMIN"&&r.status==="ACTIVE"&&r.schoolId===schoolId))
    throw new AuthError(403,"Active School Admin for this school required");
}
router.get("/parents/:parentId",run(async(req,res)=>{
  const parentId=z.coerce.number().int().positive().parse(req.params.parentId);
  const {schoolId}=z.object({schoolId:z.coerce.number().int().positive()}).strict().parse(req.query);
  schoolAdmin(req,schoolId);
  res.set("Cache-Control","no-store").json(await parentTelegramInvitationStatus(pool,parentId,schoolId));
}));
router.post("/parents/:parentId/invitation",run(async(req,res)=>{
  sameOrigin(req);
  const parentId=z.coerce.number().int().positive().parse(req.params.parentId);
  const {schoolId}=z.object({schoolId:z.number().int().positive()}).strict().parse(req.body);
  schoolAdmin(req,schoolId);
  const parent=await telegramDirectoryParent(pool,parentId,schoolId);
  const result=await transaction(parent.userId,async db=>{
    return createTelegramDirectoryInvitation(db,parentId,schoolId,getUserContext(req).user.id);
  });
  // Dispatch only this invitation's push, never other queued notifications.
  if(result.pushAvailable&&result.noticeId)
    void dispatchCommunicationDeliveries(pool,1,{allowConfiguredProviders:true,channels:["PUSH"],notificationIds:[Number(result.noticeId)]})
      .catch(()=>logger.warn({category:"TELEGRAM_INVITATION_PUSH_UNAVAILABLE"},"Invitation push dispatch unavailable"));
  const {noticeId:_noticeId,...safe}=result;
  res.set("Cache-Control","no-store").json(safe);
}));
export default router;
