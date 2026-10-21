import {Router,type Request} from "express";
import {z} from "zod";
import {pool} from "@workspace/db";
import {AuthError,getUserContext,requireAuthentication} from "../middlewares/auth";
import {getTelegramHealth,telegramDevelopment} from "../services/telegram-provider";
import {eligibleTelegramParent,telegramSchoolAllowed,checkTelegramRuntimeHealth,createParentTelegramChallenge,
  confirmParentTelegramLink,revokeParentTelegramLink,openTelegramChat} from "../services/telegram-links";
const router=Router();
router.use(requireAuthentication());
router.use((_req,res,next)=>telegramDevelopment(process.env)?next():res.status(404).json({error:"Development channel only"}));
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
  try{if(permitted.includes(new URL(req.get("Origin")??"").host))return;}catch{}
  throw new AuthError(403,"Open Telegram controls from the EduCore app");
}
async function audit(db:any,userId:number,schoolId:number|null,event:string){
  await db.query(`INSERT INTO audit_logs(actor_user_id,"user",role,school_id,action,module,event_type,result,metadata)
    SELECT id,email,$4,$2,$3,'Communication',$3,'SUCCESS','{}'::jsonb FROM app_users WHERE id=$1`,
    [userId,schoolId,event,event==="TELEGRAM_CONFIGURATION_CHECK"?"PLATFORM_OWNER":"PARENT"]);
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
  const pending=parent&&h.ready?(await pool.query(`SELECT pending_ciphertext FROM telegram_link_challenges WHERE parent_id=$1
    AND school_id=$2 AND bot_id=$3 AND expires_at>now() AND claimed_at IS NOT NULL AND confirmed_at IS NULL
    AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`,[parent.id,schoolId,h.botId])).rows[0]:null;
  let label=null;try{if(pending)label=openTelegramChat(parent.id,pending.pending_ciphertext).label;}catch{}
  let linked=false;
  try{if(link?.consented_at&&link.bot_id===h.botId&&own){openTelegramChat(own.id,link.chat_ciphertext);linked=true;}}catch{}
  res.set("Cache-Control","no-store").json({...safe,linked,consented:!!link?.consented_at,
    parentEligible:eligible,policyAllowed:!!schoolId&&await telegramSchoolAllowed(pool,schoolId),
    pending:!!label,pendingAccountLabel:label});
}));
let lastOwnerCheck=0;
router.post("/health",run(async(req,res)=>{
  if(!isOwner(req))throw new AuthError(403,"Platform Owner only");
  sameOrigin(req);
  if(Date.now()-lastOwnerCheck<10000){res.status(429).json({error:"Wait ten seconds before checking again"});return;}
  lastOwnerCheck=Date.now();
  const {botId:_botId,...h}=await checkTelegramRuntimeHealth(pool);
  await audit(pool,getUserContext(req).user.id,null,"TELEGRAM_CONFIGURATION_CHECK");
  res.set("Cache-Control","no-store").json({...h,linked:false,consented:false,parentEligible:false,
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
  const q=z.object({schoolId:z.number().int().positive()}).strict().parse(req.body);
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
export default router;
