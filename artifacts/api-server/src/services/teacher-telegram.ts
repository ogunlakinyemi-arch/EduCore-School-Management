import {randomBytes} from "node:crypto";
import {AuthError} from "../middlewares/auth";
import {getTelegramHealth} from "./telegram-provider";
import {sealTelegramChat,openTelegramChat,telegramTokenHash,telegramChatHash} from "./telegram-links";
import {loadNotificationPolicy,allowedNotificationChannels} from "./notification-channel-policy";
import {ownerNotificationDevelopment} from "./owner-notification-controls";
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
const development=()=>{if(!ownerNotificationDevelopment())throw new AuthError(404,"Teacher Telegram is Development only");};
export async function eligibleTelegramTeacher(db:Db,userId:number,schoolId:number){
  return (await db.query(`SELECT e.id FROM employees e JOIN app_users u ON u.id=e.user_id
    JOIN schools s ON s.id=e.school_id WHERE e.user_id=$1 AND e.school_id=$2
    AND upper(e.employee_type)='TEACHER' AND upper(e.employment_status)='ACTIVE'
    AND upper(u.status)='ACTIVE' AND upper(s.status)='ACTIVE'
    AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=e.user_id AND m.school_id=e.school_id
      AND m.role='TEACHER' AND upper(m.status)='ACTIVE')
    AND NOT EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=e.user_id
      AND m.role='PLATFORM_OWNER' AND upper(m.status)='ACTIVE') LIMIT 1`,[userId,schoolId])).rows.length>0;
}
async function policy(db:Db,schoolId:number){
  return allowedNotificationChannels(await loadNotificationPolicy(db),"ACADEMIC",schoolId).includes("TELEGRAM");
}
async function audit(db:Db,userId:number,schoolId:number|null,event:string){
  await db.query(`INSERT INTO audit_logs(actor_user_id,"user",role,school_id,action,module,event_type,result,metadata)
    SELECT id,email,'TEACHER',$2,$3,'Communication',$3,'SUCCESS','{}'::jsonb FROM app_users WHERE id=$1`,
    [userId,schoolId,event]);
}
export async function createTeacherTelegramChallenge(db:Db,userId:number,schoolId:number){
  development();
  const h=getTelegramHealth();
  if(!h.ready)throw new AuthError(503,"Telegram unavailable");
  if(!await eligibleTelegramTeacher(db,userId,schoolId)||!await policy(db,schoolId))
    throw new AuthError(403,"Active teacher and Owner Telegram permission required");
  const count=(await db.query(`SELECT count(*)::int AS count FROM teacher_telegram_challenges
    WHERE user_id=$1 AND created_at>now()-interval '10 minutes'`,[userId])).rows[0]?.count??0;
  if(count>=5)throw new AuthError(409,"Wait ten minutes before requesting another link");
  await db.query(`UPDATE teacher_telegram_challenges SET revoked_at=now(),pending_ciphertext=NULL,chat_hash=NULL
    WHERE user_id=$1 AND confirmed_at IS NULL AND revoked_at IS NULL`,[userId]);
  const token=`t_${randomBytes(32).toString("base64url")}`;
  const row=(await db.query(`INSERT INTO teacher_telegram_challenges(user_id,school_id,bot_id,token_hash,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '10 minutes') RETURNING expires_at AS "expiresAt"`,
    [userId,schoolId,h.botId,telegramTokenHash(token)])).rows[0];
  await audit(db,userId,schoolId,"TEACHER_TELEGRAM_LINK_REQUESTED");
  return {url:`https://t.me/${h.botUsername}?start=${token}`,expiresAt:new Date(row.expiresAt).toISOString()};
}
/** Called only after the existing poller verifies a private user-owned chat.
 * A distinct token namespace cannot consume a parent's challenge. No bot reply. */
export async function acceptTeacherTelegramUpdate(db:Db,message:any,env:NodeJS.ProcessEnv=process.env){
  if(!ownerNotificationDevelopment(env))return false;
  if(!getTelegramHealth(env).ready||message?.chat?.type!=="private"
    ||!Number.isSafeInteger(message.chat.id)||message.chat.id<=0
    ||message.from?.id!==message.chat.id||message.from?.is_bot===true)return false;
  const h=getTelegramHealth(env),chat=String(message.chat.id),hash=telegramChatHash(chat,env);
  if(/^\/(stop|unlink)$/.test(message.text??"")){
    const users=(await db.query(`SELECT user_id FROM teacher_telegram_links WHERE chat_hash=$1 AND bot_id=$2
      UNION SELECT user_id FROM teacher_telegram_challenges WHERE chat_hash=$1 AND bot_id=$2 AND revoked_at IS NULL`,
      [hash,h.botId])).rows;
    for(const user of users){
      await db.query("SELECT pg_advisory_xact_lock(31972,$1)",[user.user_id]);
      await revokeTeacherTelegramLink(db,user.user_id);
    }
    return users.length>0;
  }
  const token=/^\/(?:start|link) (t_[A-Za-z0-9_-]{43})$/.exec(message.text??"")?.[1];
  if(!token)return false;
  const row=(await db.query(`SELECT * FROM teacher_telegram_challenges WHERE token_hash=$1 AND bot_id=$2
    AND expires_at>now() AND claimed_at IS NULL AND confirmed_at IS NULL AND revoked_at IS NULL`,
    [telegramTokenHash(token),h.botId])).rows[0];
  if(!row)return false;
  await db.query("SELECT pg_advisory_xact_lock(31972,$1)",[row.user_id]);
  if(!await eligibleTelegramTeacher(db,row.user_id,row.school_id)||!await policy(db,row.school_id))return false;
  const label=typeof message.from.username==="string"&&/^[A-Za-z0-9_]{1,32}$/.test(message.from.username)
    ?`@${message.from.username}`:"Private Telegram account";
  const result=await db.query(`UPDATE teacher_telegram_challenges SET claimed_at=now(),pending_ciphertext=$2,chat_hash=$3
    WHERE id=$1 AND claimed_at IS NULL AND confirmed_at IS NULL AND revoked_at IS NULL
    AND expires_at>now() RETURNING id`,
    [row.id,sealTelegramChat(-row.user_id,{chatId:chat,label},env),hash]);
  if(result.rows.length)await audit(db,row.user_id,row.school_id,"TEACHER_TELEGRAM_CHAT_CLAIMED");
  return result.rows.length>0;
}
export async function confirmTeacherTelegramLink(db:Db,userId:number,schoolId:number){
  development();const h=getTelegramHealth();
  if(!h.ready)throw new AuthError(503,"Telegram unavailable");
  if(!await eligibleTelegramTeacher(db,userId,schoolId)||!await policy(db,schoolId))
    throw new AuthError(403,"Active teacher and Owner Telegram permission required");
  const row=(await db.query(`SELECT * FROM teacher_telegram_challenges WHERE user_id=$1 AND school_id=$2
    AND bot_id=$3 AND expires_at>now() AND claimed_at IS NOT NULL AND confirmed_at IS NULL
    AND revoked_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`,[userId,schoolId,h.botId])).rows[0];
  if(!row)throw new AuthError(409,"Start the bot using your current personal link before confirming");
  openTelegramChat(-userId,row.pending_ciphertext);
  await db.query(`INSERT INTO teacher_telegram_links(user_id,school_id,bot_id,chat_ciphertext,chat_hash,consented_at)
    VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(user_id) DO UPDATE SET school_id=excluded.school_id,
    bot_id=excluded.bot_id,chat_ciphertext=excluded.chat_ciphertext,chat_hash=excluded.chat_hash,
    consented_at=now(),revoked_at=NULL,updated_at=now()`,
    [userId,schoolId,h.botId,row.pending_ciphertext,row.chat_hash]);
  await db.query(`UPDATE teacher_telegram_challenges SET confirmed_at=now(),pending_ciphertext=NULL,chat_hash=NULL WHERE id=$1`,[row.id]);
  await audit(db,userId,schoolId,"TEACHER_TELEGRAM_ACCOUNT_LINKED");
}
export async function revokeTeacherTelegramLink(db:Db,userId:number){
  development();
  await db.query(`UPDATE teacher_telegram_links SET consented_at=NULL,revoked_at=now(),chat_ciphertext=NULL,
    chat_hash=NULL,updated_at=now() WHERE user_id=$1`,[userId]);
  await db.query(`UPDATE teacher_telegram_challenges SET revoked_at=now(),pending_ciphertext=NULL,chat_hash=NULL
    WHERE user_id=$1 AND confirmed_at IS NULL`,[userId]);
  await db.query(`UPDATE communication_deliveries d SET status='CANCELLED',error_code='TELEGRAM_CONSENT_WITHDRAWN',
    last_error='Teacher Telegram consent withdrawn',updated_at=now() FROM communication_notifications n
    WHERE n.id=d.notification_id AND n.recipient_user_id=$1 AND n.event_key LIKE 'TEACHER_PERIOD:%'
    AND d.channel='TELEGRAM' AND d.status IN ('QUEUED','FAILED')`,[userId]);
  await audit(db,userId,null,"TEACHER_TELEGRAM_CONSENT_WITHDRAWN");
}
export async function teacherTelegramRecipient(db:Db,userId:number,schoolId:number){
  if(!ownerNotificationDevelopment()||!getTelegramHealth().ready
    ||!await eligibleTelegramTeacher(db,userId,schoolId))return null;
  const pref=(await db.query(`SELECT enabled FROM communication_preferences WHERE user_id=$1
    AND category='ACADEMIC' AND channel='TELEGRAM' AND (school_id=$2 OR school_id IS NULL)
    ORDER BY school_id NULLS LAST LIMIT 1`,[userId,schoolId])).rows[0];
  if(pref?.enabled===false)return null;
  const link=(await db.query(`SELECT chat_ciphertext FROM teacher_telegram_links WHERE user_id=$1 AND school_id=$2
    AND bot_id=$3 AND consented_at IS NOT NULL AND revoked_at IS NULL`,[userId,schoolId,getTelegramHealth().botId])).rows[0];
  if(!link)return null;
  try{return openTelegramChat(-userId,link.chat_ciphertext).chatId;}catch{return null;}
}
export async function teacherTelegramStatus(db:Db,userId:number,schoolId?:number){
  development();const {botId,...h}=getTelegramHealth();
  const eligible=!!schoolId&&await eligibleTelegramTeacher(db,userId,schoolId);
  const link=(await db.query(`SELECT * FROM teacher_telegram_links WHERE user_id=$1`,[userId])).rows[0];
  const pending=eligible&&h.ready?(await db.query(`SELECT pending_ciphertext FROM teacher_telegram_challenges
    WHERE user_id=$1 AND school_id=$2 AND bot_id=$3 AND expires_at>now() AND claimed_at IS NOT NULL
    AND confirmed_at IS NULL AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`,[userId,schoolId,botId])).rows[0]:null;
  let label=null,linked=false;
  try{if(pending)label=openTelegramChat(-userId,pending.pending_ciphertext).label;}catch{}
  try{if(link?.consented_at&&!link.revoked_at&&link.bot_id===botId
    &&(!schoolId||link.school_id===schoolId)){openTelegramChat(-userId,link.chat_ciphertext);linked=true;}}catch{}
  return {...h,linked,consented:linked,parentEligible:false,teacherEligible:eligible,
    policyAllowed:!!schoolId&&await policy(db,schoolId),pending:!!label,pendingAccountLabel:label,
    children:[],schoolName:null,phoneCheck:null,invitationOnly:false};
}
